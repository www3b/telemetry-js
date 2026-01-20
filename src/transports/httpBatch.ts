import type { Envelope, Transport } from "../core/types";
import { safeJsonStringify } from "../utils/safeJson";

export type RetryOptions = {
	/**
	 * How many retries after the initial attempt.
	 * retries=0 => no retry.
	 */
	retries?: number;

	/**
	 * Base delay for exponential backoff (ms).
	 * attempt=1 => baseDelayMs
	 * attempt=2 => baseDelayMs*2
	 * attempt=3 => baseDelayMs*4 ...
	 */
	baseDelayMs?: number;

	/**
	 * Maximum delay (ms).
	 */
	maxDelayMs?: number;

	/**
	 * Jitter ratio in [0..1].
	 * Example: 0.2 => delay is multiplied by a factor within [0.8..1.2].
	 */
	jitter?: number;

	/**
	 * Which HTTP statuses should be retried.
	 * Defaults to: 408, 429, 500-599
	 */
	retryOnStatus?: (status: number) => boolean;

	/**
	 * RNG injection for tests.
	 */
	random?: () => number;
};

export type HttpBatchTransportOptions = {
	url: string;

	/** Flush interval in ms (set 0 to disable timer-based flush) */
	flushIntervalMs?: number;

	/** Max entries per request */
	maxBatch?: number;

	/** Max queued entries before start dropping */
	maxQueue?: number;

	/** Additional headers for fetch */
	headers?: Record<string, string>;

	/**
	 * Transform the outgoing entry shape (e.g. drop ctx keys).
	 */
	mapEntry?: (entry: Envelope) => unknown;

	/**
	 * Dependency injection for environments without global fetch.
	 */
	fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

	/**
	 * Enable browser delivery on pagehide/visibilitychange:
	 * - uses navigator.sendBeacon if available
	 * - otherwise uses fetch({ keepalive: true })
	 */
	flushOnUnload?: boolean;

	/**
	 * If true, drops the oldest entries when maxQueue exceeded.
	 * If false, drops the newest entry.
	 */
	dropOldest?: boolean;

	/**
	 * Retry/backoff config for network failures and retryable HTTP statuses.
	 */
	retry?: RetryOptions;
};

export type HttpBatchTransport = Transport & {
	flush: () => Promise<void>;
	stop: () => void;
	getQueueSize: () => number;
};

export function httpBatchTransport(
	options: HttpBatchTransportOptions,
): HttpBatchTransport {
	const url = options.url;
	const flushIntervalMs = options.flushIntervalMs ?? 2000;
	const maxBatch = options.maxBatch ?? 50;
	const maxQueue = options.maxQueue ?? 1000;
	const dropOldest = options.dropOldest ?? true;
	const mapEntry = options.mapEntry ?? ((entry: Envelope) => entry);

	const flushOnUnload = options.flushOnUnload ?? true;

	const fetchFn =
		options.fetchFn ??
		(typeof globalThis !== "undefined"
			? (globalThis.fetch?.bind(globalThis) as any)
			: undefined);

	enum StatusCode {
		REQUEST_TIMEOUT = 408,
		TOO_MANY_REQUESTS = 429,
		SERVER_ERROR_START = 500,
		SERVER_ERROR_END = 599,
	}

	const retry: Required<RetryOptions> = {
		retries: options.retry?.retries ?? 2,
		baseDelayMs: options.retry?.baseDelayMs ?? 250,
		maxDelayMs: options.retry?.maxDelayMs ?? 5000,
		jitter: options.retry?.jitter ?? 0.2,
		retryOnStatus:
			options.retry?.retryOnStatus ??
			((status: number) => {
				if (status === StatusCode.REQUEST_TIMEOUT) {
					return true;
				}
				if (status === StatusCode.TOO_MANY_REQUESTS) {
					return true;
				}
				if (
					status >= StatusCode.SERVER_ERROR_START &&
					status <= StatusCode.SERVER_ERROR_END
				) {
					return true;
				}
				return false;
			}),
		random: options.retry?.random ?? Math.random,
	};

	const queue: Envelope[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;
	let flushing = false;

	// Browser-only listeners cleanup
	let unloadHandler: (() => void) | null = null;
	let visibilityHandler: (() => void) | null = null;

	const buildBody = (
		batch: Envelope[],
	): { bodyText: string; bodyBlob?: Blob } => {
		const payload = {
			entries: batch.map((entry) => {
				return mapEntry(entry);
			}),
		};

		const bodyText = safeJsonStringify(payload);

		const canBlob =
			typeof Blob !== "undefined" &&
			typeof window !== "undefined" &&
			typeof document !== "undefined";

		if (canBlob) {
			return {
				bodyText,
				bodyBlob: new Blob([bodyText], { type: "application/json" }),
			};
		}

		return { bodyText };
	};

	const sleep = (ms: number) => {
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				resolve();
			}, ms);
		});
	};

	const computeDelay = (attempt: number): number => {
		// attempt: 1..N (retry attempts, not counting the initial one)
		const base = retry.baseDelayMs * 2 ** (attempt - 1);
		const capped = Math.min(base, retry.maxDelayMs);

		const j = Math.max(0, Math.min(1, retry.jitter));
		const r = retry.random();
		const factor = 1 - j + 2 * j * r;

		const delayed = Math.floor(capped * factor);
		return Math.max(0, delayed);
	};

	const postOnce = async (
		batch: Envelope[],
		keepalive: boolean,
	): Promise<Response | null> => {
		if (!fetchFn) {
			return null;
		}

		const { bodyText } = buildBody(batch);

		const headers: Record<string, string> = {
			"content-type": "application/json",
			...(options.headers ?? {}),
		};

		return fetchFn(url, {
			method: "POST",
			headers,
			body: bodyText,
			keepalive,
		} as RequestInit);
	};

	const postWithRetry = async (
		batch: Envelope[],
		keepalive: boolean,
	): Promise<void> => {
		// No fetch (safe in SSR misconfig)
		if (!fetchFn) {
			return;
		}

		// Initial attempt + N retries
		let attempt = 0;

		while (true) {
			try {
				const res = await postOnce(batch, keepalive);

				if (!res) {
					return;
				}

				if (res.ok) {
					return;
				}

				if (!retry.retryOnStatus(res.status)) {
					return;
				}

				if (attempt >= retry.retries) {
					return;
				}

				attempt += 1;
				const delay = computeDelay(attempt);
				await sleep(delay);
			} catch {
				if (attempt >= retry.retries) {
					return;
				}

				attempt += 1;
				const delay = computeDelay(attempt);
				await sleep(delay);
			}
		}
	};

	const flushInternal = async (
		reason: "timer" | "size" | "manual" | "unload",
	): Promise<void> => {
		if (stopped) {
			return;
		}

		if (flushing) {
			return;
		}

		if (queue.length === 0) {
			return;
		}

		flushing = true;

		try {
			while (queue.length > 0) {
				const batch = queue.splice(0, maxBatch);
				const keepalive = reason === "unload";

				await postWithRetry(batch, keepalive);
			}
		} finally {
			flushing = false;
		}
	};

	const pushEntry = (entry: Envelope): void => {
		if (stopped) {
			return;
		}

		if (queue.length >= maxQueue) {
			if (dropOldest) {
				const overflow = queue.length - maxQueue + 1;
				if (overflow > 0) {
					queue.splice(0, overflow);
				}
			} else {
				return;
			}
		}

		queue.push(entry);

		if (queue.length >= maxBatch) {
			void flushInternal("size");
		}
	};

	const flush = async (): Promise<void> => {
		await flushInternal("manual");
	};

	const stop = (): void => {
		stopped = true;

		if (timer) {
			clearInterval(timer);
			timer = null;
		}

		if (typeof window !== "undefined") {
			if (unloadHandler) {
				window.removeEventListener("pagehide", unloadHandler);
			}
			if (visibilityHandler) {
				window.removeEventListener("visibilitychange", visibilityHandler);
			}
		}
	};

	const getQueueSize = (): number => {
		return queue.length;
	};

	// Timer-based flush
	if (flushIntervalMs > 0) {
		timer = setInterval(() => {
			void flushInternal("timer");
		}, flushIntervalMs);
	}

	// Browser unload flush
	if (flushOnUnload && typeof window !== "undefined") {
		unloadHandler = () => {
			if (stopped) {
				return;
			}

			if (queue.length === 0) {
				return;
			}

			const batch = queue.splice(0, maxBatch);
			const { bodyText, bodyBlob } = buildBody(batch);

			const nav: any = (globalThis as any).navigator;

			if (nav?.sendBeacon && bodyBlob) {
				try {
					nav.sendBeacon(url, bodyBlob);
					return;
				} catch {
					// fall through to fetch keepalive
				}
			}

			if (fetchFn) {
				// do not retry here
				try {
					void fetchFn(url, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							...(options.headers ?? {}),
						},
						body: bodyText,
						keepalive: true,
					} as RequestInit);
				} catch {
					//
				}
			}
		};

		visibilityHandler = () => {
			if (document.visibilityState === "hidden") {
				if (unloadHandler) {
					unloadHandler();
				}
			}
		};

		window.addEventListener("pagehide", unloadHandler);
		window.addEventListener("visibilitychange", visibilityHandler);
	}

	const transport: HttpBatchTransport = Object.assign(
		(entry: Envelope) => {
			pushEntry(entry);
		},
		{
			flush,
			stop,
			getQueueSize,
		},
	);

	return transport;
}
