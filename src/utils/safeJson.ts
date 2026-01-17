export function safeJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	return JSON.stringify(value, (_k, v) => {
		if (typeof v === "bigint") return v.toString();

		if (v instanceof Error) {
			return { name: v.name, message: v.message, stack: v.stack };
		}

		if (typeof v === "object" && v !== null) {
			if (seen.has(v)) return "[Circular]";
			seen.add(v);
		}

		return v;
	});
}
