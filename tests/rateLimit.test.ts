import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { rateLimit } from "../src/middlewares/rateLimit";

const makeLog = (
	level: "debug" | "info" | "warn" | "error",
	msg: string,
	ctx: Record<string, unknown> = {},
): Envelope => ({
	ts: 0,
	ctx,
	record: { kind: "log", level, msg },
});

const makeEvent = (name: string, ctx: Record<string, unknown> = {}): Envelope => ({
	ts: 0,
	ctx,
	record: { kind: "event", name },
});

describe("rateLimit middleware", () => {
	it("limits logs per level using token bucket semantics", () => {
		let t = 0;

		const mw = rateLimit({
			log: { debug: { limit: 2, intervalMs: 1000 } },
			now: () => t,
		});

		let passed = 0;
		const next = () => {
			passed++;
		};

		// Initial burst == limit (2)
		mw(makeLog("debug", "a"), next);
		mw(makeLog("debug", "b"), next);
		mw(makeLog("debug", "c"), next);

		expect(passed).toBe(2);

		// After 500ms, refill 1 token (2/sec => 1 token per 500ms)
		t += 500;
		mw(makeLog("debug", "d"), next);
		mw(makeLog("debug", "e"), next);

		expect(passed).toBe(3);

		// After another 500ms => +1 token
		t += 500;
		mw(makeLog("debug", "f"), next);
		expect(passed).toBe(4);
	});

	it("limits events by name with '*' fallback", () => {
		let t = 0;

		const mw = rateLimit({
			event: {
				"*": { limit: 1, intervalMs: 1000 },
				page_view: { limit: 2, intervalMs: 1000 },
			},
			now: () => t,
		});

		let passed = 0;
		const next = () => {
			passed++;
		};

		// page_view has higher limit
		mw(makeEvent("page_view"), next);
		mw(makeEvent("page_view"), next);
		mw(makeEvent("page_view"), next);
		expect(passed).toBe(2);

		// click uses wildcard (1/sec)
		mw(makeEvent("click"), next);
		mw(makeEvent("click"), next);
		expect(passed).toBe(3);

		t += 1000;
		mw(makeEvent("click"), next);
		expect(passed).toBe(4);
	});

	it("isolates limits per key when key() is provided", () => {
		let t = 0;

		const mw = rateLimit({
			log: { info: { limit: 1, intervalMs: 1000 } },
			key: (entry) => entry.ctx.userId as number | undefined,
			now: () => t,
		});

		let passed = 0;
		const next = () => {
      passed++;
		};

		// userId=1 gets 1 token
		mw(makeLog("info", "u1-a", { userId: 1 }), next);
		mw(makeLog("info", "u1-b", { userId: 1 }), next);

		// userId=2 is separate bucket, also gets 1 token
		mw(makeLog("info", "u2-a", { userId: 2 }), next);
		mw(makeLog("info", "u2-b", { userId: 2 }), next);

		expect(passed).toBe(2);

		t += 1000;

		// refill for both users
		mw(makeLog("info", "u1-c", { userId: 1 }), next);
		mw(makeLog("info", "u2-c", { userId: 2 }), next);

		expect(passed).toBe(4);
	});

	it("falls back to defaultLog/defaultEvent when per-rule config is missing", () => {
		let t = 0;

		const mw = rateLimit({
			defaultLog: { limit: 1, intervalMs: 1000 },
			defaultEvent: { limit: 1, intervalMs: 1000 },
			now: () => t,
		});

		let passed = 0;
		const next = () => {
      passed++;
    }

		mw(makeLog("warn", "a"), next);
		mw(makeLog("warn", "b"), next);
		expect(passed).toBe(1);

		mw(makeEvent("anything"), next);
		mw(makeEvent("anything"), next);
		expect(passed).toBe(2);

		t += 1000;
		mw(makeLog("warn", "c"), next);
		mw(makeEvent("anything", {}), next);
		expect(passed).toBe(4);
	});
});
