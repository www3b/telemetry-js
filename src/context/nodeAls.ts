import { AsyncLocalStorage } from "node:async_hooks";
import type { Ctx } from "../core/types";
import type { ContextManager } from "./types";
import { mergeCtx } from "./types";

export class NodeAlsContext implements ContextManager {
	private global: Ctx = {};
	private als = new AsyncLocalStorage<Ctx>();

	setGlobal(ctx: Ctx) {
		this.global = mergeCtx(this.global, ctx);
	}

	getGlobal(): Ctx {
		return { ...this.global };
	}

	get(): Ctx {
		const store = this.als.getStore() ?? {};
		return mergeCtx(this.global, store);
	}

	run<T>(ctx: Ctx, fn: () => T): T {
		const current = this.als.getStore() ?? {};
		const next = mergeCtx(current, ctx);
		return this.als.run(next, fn);
	}
}
