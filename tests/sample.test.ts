import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { sample } from "../src/middlewares/sample";
import { createTelemetry } from "../src/node";

describe("sample middleware", () => {
	it("drops logs by level and events by name", async () => {
		const t = createTelemetry();

		t.use(
			sample({
				log: { debug: 0, info: 1, warn: 1, error: 1 },
				event: { "*": 0, page_view: 1 },
			}),
		);

		const seen: Envelope[] = [];
		t.addTransport((entry) => {
			seen.push(entry);
		});

		t.log.debug("dbg"); // drop
		t.log.info("info"); // keep
		t.track("click"); // drop by "*"
		t.track("page_view"); // keep

		await new Promise((r) => setTimeout(r, 0));

		expect(
			seen.some((e) => e.record.kind === "log" && e.record.level === "debug"),
		).toBe(false);
		expect(
			seen.some((e) => e.record.kind === "log" && e.record.level === "info"),
		).toBe(true);

		expect(
			seen.some((e) => e.record.kind === "event" && e.record.name === "click"),
		).toBe(false);
		expect(
			seen.some(
				(e) => e.record.kind === "event" && e.record.name === "page_view",
			),
		).toBe(true);
	});

	it("supports deterministic sampling via key()", async () => {
		const t = createTelemetry();

		t.use(
			sample({
				event: { "*": 0.5 },
				key: (entry) => entry.ctx.requestId as string | undefined,
			}),
		);

		const seen: Envelope[] = [];
		t.addTransport((entry) => {
			seen.push(entry);
		});

		// Same key should be consistently kept/dropped
		for (let i = 0; i < 10; i++) {
			t.withScope({ requestId: "same" }, () => t.track("evt"));
		}
		for (let i = 0; i < 10; i++) {
			t.withScope({ requestId: "same" }, () => t.track("evt"));
		}

		await new Promise((r) => setTimeout(r, 0));

		const count = seen.length;
		expect(count === 0 || count === 20).toBe(true);
	});
});
