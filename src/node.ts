import { NodeAlsContext } from "./context/nodeAls";
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
export { consoleTransport } from "./transports/console";
export type { CreateTelemetryOptions };
export type { DedupeOptions } from "./middlewares/dedupe";
export { dedupe } from "./middlewares/dedupe";
export type {
	RateLimitOptions,
	RateLimitWindow,
} from "./middlewares/rateLimit";
export { rateLimit } from "./middlewares/rateLimit";
export type { SampleConfig } from "./middlewares/sample";
export { sample } from "./middlewares/sample";
export type { MaskOptions } from "./middlewares/secret";
export { secret } from "./middlewares/secret";
export type {
	HttpBatchTransport,
	HttpBatchTransportOptions,
} from "./transports/httpBatch";
export { httpBatchTransport } from "./transports/httpBatch";

/**
 * Node telemetry with true async context propagation via AsyncLocalStorage.
 */
export function createTelemetry(options: CreateTelemetryOptions = {}) {
	const ctxm = new NodeAlsContext();
	return createTelemetryWithContext(ctxm, options);
}
