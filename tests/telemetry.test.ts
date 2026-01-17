import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { createTelemetry } from "../src/node";

describe("telemetry-js (node)", () => {
	it("propagates context across await (AsyncLocalStorage)", async () => {
		const t = createTelemetry({ app: "test" });

		const seen: Envelope[] = [];
		t.addTransport((env) => {
			seen.push(env);
		});

		await t.withScope({ requestId: "r1" }, async () => {
			t.log.info("a");
			await new Promise((r) => setTimeout(r, 1));
			t.log.info("b");
		});

		// give pipeline microtasks a moment
		await new Promise((r) => setTimeout(r, 1));

		expect(seen.length).toBeGreaterThanOrEqual(2);
		expect(seen[0]?.ctx.requestId).toBe("r1");
		expect(seen[1]?.ctx.requestId).toBe("r1");
	});
});
