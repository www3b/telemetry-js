import type { Ctx } from "../core/types";
import type { ContextManager } from "./types";
import { isPromiseLike, mergeCtx } from "./types";

export class BrowserStackContext implements ContextManager {
	private global: Ctx = {};
	private stack: Ctx[] = [];

	setGlobal(ctx: Ctx) {
		this.global = mergeCtx(this.global, ctx);
	}

	getGlobal(): Ctx {
		return { ...this.global };
	}

	get(): Ctx {
		const top = this.stack.length ? this.stack[this.stack.length - 1] : {};
		return mergeCtx(this.global, top);
	}

	run<T>(ctx: Ctx, fn: () => T): T {
		this.stack.push(ctx);

		try {
			const res = fn();

			if (isPromiseLike(res)) {
				return res.finally(() => {
					// ensure pop even on reject
					this.stack.pop();
				}) as unknown as T;
			}

			this.stack.pop();
			return res;
		} catch (e) {
			this.stack.pop();
			throw e;
		}
	}
}
