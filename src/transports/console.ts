import type { Envelope, Transport } from "../core/types";
import { safeJsonStringify } from "../utils/safeJson";

export function consoleTransport(): Transport {
	return (entry: Envelope) => {
		const line = safeJsonStringify(entry);

		if (entry.record.kind === "log") {
			const lvl = entry.record.level;
			const fn =
				lvl === "debug"
					? console.debug
					: lvl === "info"
						? console.info
						: lvl === "warn"
							? console.warn
							: console.error;

			// show plain message with data object
			fn(entry.record.msg, entry.record.data);
			return;
		}

		console.log(line);
	};
}
