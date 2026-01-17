export type Ctx = Record<string, unknown>;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
	kind: "log";
	level: LogLevel;
	msg: string;
	data?: Record<string, unknown>;
	err?: unknown;
};

export type EventRecord = {
	kind: "event";
	name: string;
	props?: Record<string, unknown>;
};

export type TelemetryRecord = LogRecord | EventRecord;

export type Envelope = {
	ts: number;
	ctx: Ctx;
	record: TelemetryRecord;
};

export type Transport = (env: Envelope) => void | Promise<void>;

export type Middleware = (
	env: Envelope,
	next: () => void | Promise<void>,
) => void | Promise<void>;

export type Telemetry = {
	log: {
		debug: (msg: string, data?: Record<string, unknown>) => void;
		info: (msg: string, data?: Record<string, unknown>) => void;
		warn: (msg: string, data?: Record<string, unknown>) => void;
		error: (
			msg: string,
			data?: Record<string, unknown> & { err?: unknown },
		) => void;
	};
	track: (name: string, props?: Record<string, unknown>) => void;

	// sync + async (best-effort in browser; true async propagation in node entry)
	withScope: <T>(ctx: Ctx, fn: () => T) => T;

	setGlobalContext: (ctx: Ctx) => void;
	getGlobalContext: () => Ctx;

	use: (mw: Middleware) => void;
	addTransport: (t: Transport) => void;
};
