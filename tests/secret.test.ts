/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
import { describe, expect, it } from "vitest";
import type { Envelope } from "../src/core/types";
import { secret } from "../src/middlewares/secret";
import { createTelemetry } from "../src/node";

describe("secret middleware", () => {
	it("Masks keys in ctx, log.data and event.props (case-insensitive, substring)", async () => {
		const t = createTelemetry();

		t.use(
			secret({
				keys: ["token", "password", "authorization"],
			}),
		);

		const seen: Envelope[] = [];
		t.addTransport((entry) => {
			seen.push(entry);
		});

		t.setGlobalContext({ Authorization: "Bearer secret" });

		t.withScope({ accessToken: "abc", nested: { password: "p" } }, () => {
			t.log.info("hello", {
				token: "t",
				deep: { myPassword: "x" },
			});

			t.track("evt", {
				authorizationHeader: "y",
				ok: true,
			});
		});

		await new Promise((r) => setTimeout(r, 0));

		expect(seen.length).toBe(2);

		const log = seen.find((e) => e.record.kind === "log")!;
		expect(log.ctx.Authorization).toBe("[MASKED]");
		expect(log.ctx.accessToken).toBe("[MASKED]");
		expect((log.ctx.nested as any).password).toBe("[MASKED]");
		expect((log.record.kind === "log" ? log.record.data : null)!.token).toBe(
			"[MASKED]",
		);
		expect(
			((log.record.kind === "log" ? log.record.data : null) as any).deep
				.myPassword,
		).toBe("[MASKED]");

		const evt = seen.find((e) => e.record.kind === "event")!;
		expect(
			(evt.record.kind === "event" ? evt.record.props : null) as any,
		).toMatchObject({
			authorizationHeader: "[MASKED]",
			ok: true,
		});
	});

	it("respects paths option", async () => {
		const t = createTelemetry();

		t.use(
			secret({
				keys: ["token"],
				paths: ["event.props"],
			}),
		);

		const seen: Envelope[] = [];
		t.addTransport((entry) => {
			seen.push(entry);
		});

		t.withScope({ token: "ctx-secret" }, () => {
			t.log.info("log", { token: "log-secret" });
			t.track("evt", { token: "event-secret" });
		});

		await new Promise((r) => setTimeout(r, 0));

		const log = seen.find((e) => e.record.kind === "log")!;
		expect(log.ctx.token).toBe("ctx-secret"); // not masked
		expect((log.record.kind === "log" ? log.record.data : null)!.token).toBe(
			"log-secret",
		); // not masked

		const evt = seen.find((e) => e.record.kind === "event")!;
		expect((evt.record.kind === "event" ? evt.record.props : null)!.token).toBe(
			"[MASKED]",
		);
	});
});
