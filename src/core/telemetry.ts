import type { ContextManager } from "../context/types";
import { now } from "../utils/now";
import { Pipeline } from "./pipeline";
import type { Ctx, Envelope, Middleware, Telemetry, Transport } from "./types";

export type CreateTelemetryOptions = {
	app?: string;
	version?: string;
};

export function createTelemetryWithContext(
	ctxm: ContextManager,
	opts: CreateTelemetryOptions = {},
): Telemetry {
	const pipeline = new Pipeline();

	const base: Ctx = {};
	if (opts.app) {
		base.app = opts.app;
	}
	if (opts.version) {
		base.version = opts.version;
	}
	if (Object.keys(base).length) {
		ctxm.setGlobal(base);
	}

	const emit = (record: Envelope["record"], extraCtx?: Ctx) => {
		const entry: Envelope = {
			ts: now(),
			ctx: { ...ctxm.get(), ...(extraCtx ?? {}) },
			record,
		};

		void pipeline.dispatch(entry);
	};

	return {
		log: {
			debug: (msg, data) => emit({ kind: "log", level: "debug", msg, data }),
			info: (msg, data) => emit({ kind: "log", level: "info", msg, data }),
			warn: (msg, data) => emit({ kind: "log", level: "warn", msg, data }),
			error: (msg, data) =>
				emit({ kind: "log", level: "error", msg, data, err: data?.err }),
		},

		track: (name, props) => emit({ kind: "event", name, props }),

		withScope: (ctx, fn) => ctxm.run(ctx, fn),

		setGlobalContext: (ctx) => ctxm.setGlobal(ctx),
		getGlobalContext: () => ctxm.getGlobal(),

		use: (mw: Middleware) => pipeline.use(mw),
		addTransport: (t: Transport) => pipeline.addTransport(t),
	};
}
