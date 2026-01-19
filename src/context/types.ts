import type { Ctx } from "../core/types";

export type ContextManager = {
	run<T>(ctx: Ctx, fn: () => T): T;
	get(): Ctx;

	setGlobal(ctx: Ctx): void;
	getGlobal(): Ctx;
};

export function mergeCtx(...parts: Array<Ctx | undefined>): Ctx {
	const out: Ctx = {};
	for (const p of parts) {
		if (!p) {
			continue;
		}
		for (const k of Object.keys(p)) {
			out[k] = p[k];
		}
	}
	return out;
}

export function isPromiseLike(x: unknown): x is Promise<unknown> {
	return (
		typeof x === "object" &&
		x !== null &&
		"then" in x &&
		typeof (x as { then?: unknown }).then === "function"
	);
}
