import { BrowserStackContext } from "./context/browserStack";
import {
	type CreateTelemetryOptions,
	createTelemetryWithContext,
} from "./core/telemetry";

export type {
	Ctx,
	Envelope,
	LogLevel,
	Middleware,
	Telemetry,
	Transport,
} from "./core/types";
export type { CreateTelemetryOptions };
export type { MaskOptions } from "./middlewares/secret";
export { secret } from "./middlewares/secret";
export { consoleTransport } from "./transports/console";
export type {
	HttpBatchTransport,
	HttpBatchTransportOptions,
} from "./transports/httpBatch";
export { httpBatchTransport } from "./transports/httpBatch";

/**
 * Browser-safe telemetry.
 */
export function createTelemetry(options: CreateTelemetryOptions = {}) {
	const ctxm = new BrowserStackContext();
	return createTelemetryWithContext(ctxm, options);
}
