import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { meta } from "../src/middlewares/meta";

const makeLog = (msg: string, ctx: Record<string, unknown> = {}): Envelope => {
	return {
		ts: 123,
		ctx,
		record: { kind: "log", level: "info", msg, data: { ok: true } },
	};
};

const makeEvent = (
	name: string,
	ctx: Record<string, unknown> = {},
): Envelope => {
	return {
		ts: 456,
		ctx,
		record: { kind: "event", name, props: { a: 1 } },
	};
};

describe("meta middleware", () => {
	it("merges static meta into entry.ctx by default", () => {
		const mw = meta({
			meta: { app: "x", env: "dev" },
		});

		const entry = makeLog("hello", { requestId: "r1" });

		let passed = 0;
		mw(entry, () => {
			passed += 1;
		});

		expect(passed).toBe(1);
		expect(entry.ctx).toMatchObject({ requestId: "r1", app: "x", env: "dev" });
	});

	it("runs providers in order and lets later override earlier", () => {
		const mw = meta({
			meta: { a: 1, shared: "base" },
			providers: [
				() => {
					return { b: 2, shared: "p1" };
				},
				() => {
					return { c: 3, shared: "p2" };
				},
			],
		});

		const entry = makeLog("hello");

		mw(entry, () => {});

		expect(entry.ctx).toMatchObject({ a: 1, b: 2, c: 3, shared: "p2" });
	});

	it("can namespace meta under ctx.meta instead of merging", () => {
		const mw = meta({
			meta: { app: "x" },
			mergeIntoCtx: false,
		});

		const entry = makeLog("hello", { requestId: "r1" });

		mw(entry, () => {});

		expect(entry.ctx.requestId).toBe("r1");
		expect(entry.ctx.meta).toEqual({ app: "x" });
	});

	it("supports includeTimestamp and includeRecordInfo", () => {
		const mw = meta({
			includeTimestamp: true,
			includeRecordInfo: true,
		});

		const logEntry = makeLog("hello");
		mw(logEntry, () => {});
		expect(logEntry.ctx).toMatchObject({
			timestamp: 123,
			kind: "log",
			level: "info",
		});

		const eventEntry = makeEvent("click");
		mw(eventEntry, () => {});
		expect(eventEntry.ctx).toMatchObject({
			timestamp: 456,
			kind: "event",
			name: "click",
		});
	});

	it("swallows provider errors", () => {
		const mw = meta({
			meta: { base: true },
			providers: [
				() => {
					throw new Error("boom");
				},
				() => {
					return { ok: true };
				},
			],
		});

		const entry = makeLog("hello");

		mw(entry, () => {});

		expect(entry.ctx).toMatchObject({ base: true, ok: true });
	});

	it("merges into existing namespace object if present", () => {
		const mw = meta({
			meta: { a: 1 },
			mergeIntoCtx: false,
			namespaceKey: "meta",
		});

		const entry = makeLog("hello", { meta: { existing: true } });

		mw(entry, () => {});

		expect(entry.ctx.meta).toEqual({ existing: true, a: 1 });
	});
});
