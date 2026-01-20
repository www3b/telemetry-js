import type { Envelope, Middleware } from "../core/types";

export type MaskOptions = {
	/**
	 * Keys to hide (case-insensitive). Example: ["token","password","authorization"]
	 */
	keys: string[];

	/**
	 * Replacement value.
	 */
	replacement?: string;

	/**
	 * If true, also mask keys that contain any of the listed tokens:
	 * e.g. "accessToken" contains "token".
	 */
	matchSubstring?: boolean;

	/**
	 * Limit recursion depth to avoid huge objects.
	 */
	maxDepth?: number;

	/**
	 * Mask only in these places. Default: all.
	 */
	paths?: Array<"ctx" | "log.data" | "log.err" | "event.props">;
};

export function secret(options: MaskOptions): Middleware {
	const replacement = options.replacement ?? "[MASKED]";
	const matchSubstring = options.matchSubstring ?? true;
	const maxDepth = options.maxDepth ?? 20;

	const keyTokens = options.keys.map((k) => k.toLowerCase());
	const enabledPaths = new Set(
		options.paths ?? ["ctx", "log.data", "log.err", "event.props"],
	);

	const shouldMaskKey = (key: string): boolean => {
		const k = key.toLowerCase();
		if (matchSubstring) {
			return keyTokens.some((t) => k.includes(t));
		}
		return keyTokens.includes(k);
	};

	return (entry, next) => {
		// ctx
		if (enabledPaths.has("ctx")) {
			maskValueInPlace(entry.ctx, shouldMaskKey, replacement, maxDepth);
		}

		// record-specific
		if (entry.record.kind === "log") {
			if (enabledPaths.has("log.data") && entry.record.data) {
				maskValueInPlace(
					entry.record.data,
					shouldMaskKey,
					replacement,
					maxDepth,
				);
			}
			if (enabledPaths.has("log.err") && entry.record.err) {
				maskValueInPlace(
					entry.record.err,
					shouldMaskKey,
					replacement,
					maxDepth,
				);
			}
		} else {
			if (enabledPaths.has("event.props") && entry.record.props) {
				maskValueInPlace(
					entry.record.props,
					shouldMaskKey,
					replacement,
					maxDepth,
				);
			}
		}

		return next();
	};
}

function maskValueInPlace(
	value: unknown,
	shouldMaskKey: (k: string) => boolean,
	replacement: string,
	maxDepth: number,
	depth = 0,
	seen = new WeakSet<object>(),
): void {
	if (depth > maxDepth) {
		return;
	}

	if (typeof value !== "object" || value === null) {
		return;
	}

	// Protect from cycles
	if (seen.has(value)) {
		return;
	}
	seen.add(value);

	if (Array.isArray(value)) {
		for (const item of value) {
			maskValueInPlace(
				item,
				shouldMaskKey,
				replacement,
				maxDepth,
				depth + 1,
				seen,
			);
		}
		return;
	}

	const obj = value as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (shouldMaskKey(key)) {
			obj[key] = replacement;
			continue;
		}
		maskValueInPlace(
			obj[key],
			shouldMaskKey,
			replacement,
			maxDepth,
			depth + 1,
			seen,
		);
	}
}
