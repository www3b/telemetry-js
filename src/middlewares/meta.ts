import { mergeCtx } from "../context/types";
import type { Ctx, Envelope, Middleware } from "../core/types";

export type MetaProvider = (entry: Envelope) => Ctx | null | undefined;

export type MetaOptions = {
	/**
	 * Static metadata added to every entry.
	 */
	meta?: Ctx;

	/**
	 * Dynamic providers. Executed in order.
	 */
	providers?: MetaProvider[];

	/**
	 * If true, meta is added to entry.ctx (default).
	 * If false, meta is stored under entry.ctx.meta.
	 */
	mergeIntoCtx?: boolean;

	/**
	 * If namespaced, the namespace key. Default: "meta".
	 */
	namespaceKey?: string;

	/**
	 * If true, attach entry.ts to ctx as "timestamp".
	 */
	includeTimestamp?: boolean;

	/**
	 * If true, attach record kind/level/name into ctx:
	 * - kind: "log" | "event"
	 * - level for logs
	 * - name for events
	 */
	includeRecordInfo?: boolean;
};

export function meta(options: MetaOptions = {}): Middleware {
	const staticMeta = options.meta ?? {};
	const providers = options.providers ?? [];
	const mergeIntoCtx = options.mergeIntoCtx ?? true;
	const namespaceKey = options.namespaceKey ?? "meta";
	const includeTimestamp = options.includeTimestamp ?? false;
	const includeRecordInfo = options.includeRecordInfo ?? false;

	return (entry, next) => {
		let out: Ctx = staticMeta;

		if (includeTimestamp) {
			out = mergeCtx(out, { timestamp: entry.ts });
		}

		if (includeRecordInfo) {
			if (entry.record.kind === "log") {
				out = mergeCtx(out, { kind: "log", level: entry.record.level });
			} else {
				out = mergeCtx(out, { kind: "event", name: entry.record.name });
			}
		}

		for (const p of providers) {
			try {
				const add = p(entry);
				if (add) {
					out = mergeCtx(out, add);
				}
			} catch {
				// meta should not break telemetry pipeline
			}
		}

		if (Object.keys(out).length > 0) {
			if (mergeIntoCtx) {
				entry.ctx = mergeCtx(entry.ctx, out);
			} else {
				const existing = entry.ctx[namespaceKey];
				if (existing && typeof existing === "object") {
					entry.ctx[namespaceKey] = mergeCtx(existing as Ctx, out);
				} else {
					entry.ctx[namespaceKey] = out;
				}
			}
		}

		return next();
	};
}
