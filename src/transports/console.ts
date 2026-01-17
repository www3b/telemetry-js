import type { Envelope, Transport } from "../core/types";
import { safeJsonStringify } from "../utils/safeJson";

export function consoleTransport(): Transport {
	return (env: Envelope) => {
		const line = safeJsonStringify(env);

		if (env.record.kind === "log") {
			const lvl = env.record.level;
			const fn =
				lvl === "debug"
					? console.debug
					: lvl === "info"
						? console.info
						: lvl === "warn"
							? console.warn
							: console.error;

			// show plain message for logs
			fn(env.record.msg);
			return;
		}

		console.log(line);
	};
}
