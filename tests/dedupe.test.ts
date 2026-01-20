import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { dedupe } from "../src/middlewares/dedupe";

const makeLog = (msg: string, ctx: Record<string, unknown> = {}): Envelope => {
	return {
		ts: 0,
		ctx,
		record: { kind: "log", level: "info", msg, data: { a: 1 } },
	};
};

const makeEvent = (
	name: string,
	props: Record<string, unknown> = {},
	ctx: Record<string, unknown> = {},
): Envelope => {
	return {
		ts: 0,
		ctx,
		record: { kind: "event", name, props },
	};
};

describe("dedupe middleware", () => {
	it("drops duplicates within ttlMs and allows after ttlMs", () => {
		let t = 0;

		const mw = dedupe({
			ttlMs: 1000,
			now: () => t,
		});

		let passed = 0;
		const next = () => {
			passed += 1;
		};

		mw(makeLog("hello"), next);
		mw(makeLog("hello"), next);
		mw(makeLog("hello"), next);

		expect(passed).toBe(1);

		t += 999;
		mw(makeLog("hello"), next);
		expect(passed).toBe(1);

		t += 1;
		mw(makeLog("hello"), next);
		expect(passed).toBe(2);
	});

	it("dedupes events based on name+props by default", () => {
		const t = 0;

		const mw = dedupe({
			ttlMs: 1000,
			now: () => t,
		});

		let passed = 0;
		const next = () => {
			passed += 1;
		};

		mw(makeEvent("click", { button: "save" }), next);
		mw(makeEvent("click", { button: "save" }), next);
		mw(makeEvent("click", { button: "cancel" }), next);

		expect(passed).toBe(2);
	});

	it("isolates duplicates per key() when provided", () => {
		const t = 0;

		const mw = dedupe({
			ttlMs: 1000,
			now: () => t,
			key: (entry) => entry.ctx.userId as number | undefined,
		});

		let passed = 0;
		const next = () => {
			passed += 1;
		};

		mw(makeLog("hello", { userId: 1 }), next);
		mw(makeLog("hello", { userId: 1 }), next);

		mw(makeLog("hello", { userId: 2 }), next);
		mw(makeLog("hello", { userId: 2 }), next);

		expect(passed).toBe(2);
	});

	it("evicts old fingerprints when maxSize is exceeded (LRU-ish)", () => {
		const t = 0;

		const mw = dedupe({
			ttlMs: 10000,
			maxSize: 2,
			now: () => t,
			cleanupEvery: 1, // force frequent cleanup
		});

		let passed = 0;
		const next = () => {
			passed += 1;
		};

		// Fill cache with two distinct fingerprints
		mw(makeLog("a"), next);
		mw(makeLog("b"), next);

		// Add third => evict LRU ("a")
		mw(makeLog("c"), next);

		// Now "a" should behave like new (was evicted), so it should pass again
		mw(makeLog("a"), next);

		expect(passed).toBe(4);
	});

	it("accepts custom fingerprint function", () => {
		let t = 0;

		const mw = dedupe({
			ttlMs: 1000,
			now: () => t,
			fingerprint: (entry) => {
				if (entry.record.kind === "log") {
					return `L:${entry.record.msg}`;
				}
				return `E:${entry.record.name}`;
			},
		});

		let passed = 0;
		const next = () => {
			passed += 1;
		};

		mw(makeEvent("x", { a: 1 }), next);
		mw(makeEvent("x", { a: 999 }), next); // same fingerprint - dropped
		expect(passed).toBe(1);

		t += 1000;
		mw(makeEvent("x", { a: 999 }), next);
		expect(passed).toBe(2);
	});
});
