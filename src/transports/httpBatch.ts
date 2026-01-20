import type { Envelope, Transport } from "../core/types";
import { safeJsonStringify } from "../utils/safeJson";

export type HttpBatchTransportOptions = {
	/** Endpoint to POST telemetry batches to */
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
	 * Optional transform (e.g. remove ctx fields, rename keys, etc.)
	 * NOTE: transform must return JSON-serializable data (or rely on safeJsonStringify behavior).
	 */
	mapEntry?: (entry: Envelope) => unknown;

	/**
	 * Dependency injection for tests / Node environments without global fetch.
	 * Defaults to globalThis.fetch if available.
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
	const mapEntry = options.mapEntry ?? ((e: Envelope) => e);
	const flushOnUnload = options.flushOnUnload ?? true;

	const fetchFn =
		options.fetchFn ??
		(typeof globalThis !== "undefined"
			? (globalThis.fetch?.bind(globalThis) as any)
			: undefined);

	const queue: Envelope[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let flushing = false;
	let stopped = false;

	const buildBody = (
		batch: Envelope[],
	): { bodyText: string; bodyBlob?: Blob } => {
		const payload = {
			entries: batch.map((entry) => mapEntry(entry)),
		};

		const bodyText = safeJsonStringify(payload);

		// in browsers only
		const canBlob =
			typeof Blob !== "undefined" &&
			typeof window !== "undefined" &&
			typeof document !== "undefined";

		return {
			bodyText,
			bodyBlob: canBlob
				? new Blob([bodyText], { type: "application/json" })
				: undefined,
		};
	};

	const postBatch = async (
		batch: Envelope[],
		keepalive: boolean,
	): Promise<void> => {
		if (!fetchFn) {
			return;
		}

		const { bodyText } = buildBody(batch);

		const headers: Record<string, string> = {
			"content-type": "application/json",
			...(options.headers ?? {}),
		};

		// Never throw out — telemetry must not crash the app
		try {
			await fetchFn(url, {
				method: "POST",
				headers,
				body: bodyText,
				// keepalive is ignored in Node, works in browsers
				keepalive,
			} as RequestInit);
		} catch {
			// TODO: maybe handle error
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
				await postBatch(batch, keepalive);
			}
		} finally {
			flushing = false;
		}
	};

	const flush = () => flushInternal("manual");

	const stop = () => {
		stopped = true;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	const getQueueSize = () => queue.length;

	const pushEntry = (entry: Envelope): void => {
		if (stopped) {
			return;
		}

		if (queue.length >= maxQueue) {
			if (dropOldest) {
				const overflow = queue.length - maxQueue + 1;
				queue.splice(0, overflow);
			} else {
				// drop newest
				return;
			}
		}

		queue.push(entry);

		if (queue.length >= maxBatch) {
			void flushInternal("size");
		}
	};

	// Timer-based flush
	if (flushIntervalMs > 0) {
		timer = setInterval(() => {
			void flushInternal("timer");
		}, flushIntervalMs);
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

	if (flushOnUnload && typeof window !== "undefined") {
		const onUnloadLike = () => {
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
					//
				}
			}

			void postBatch(batch, true);
		};

		window.addEventListener("pagehide", onUnloadLike);
		window.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				onUnloadLike();
			}
		});

		const originalStop = stop;
		const stopWithCleanup = () => {
			window.removeEventListener("pagehide", onUnloadLike);
			originalStop();
		};

		(transport as any).stop = stopWithCleanup;
	}

	return transport;
}
