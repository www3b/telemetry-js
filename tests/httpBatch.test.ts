import { afterEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../src/core/types";
import { httpBatchTransport } from "../src/transports/httpBatch";

const makeEntry = (n: number): Envelope => ({
	ts: n,
	ctx: { requestId: "r1" },
	record: { kind: "log", level: "info", msg: `m${n}` },
});

describe("httpBatchTransport", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes by interval", async () => {
		vi.useFakeTimers();

		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchFn = async (url: any, init?: any) => {
			calls.push({ url: String(url), init });
			return new Response(null, { status: 204 });
		};

		const t = httpBatchTransport({
			url: "http://localhost/telemetry",
			flushIntervalMs: 100,
			maxBatch: 50,
			fetchFn,
			flushOnUnload: false,
		});

		t(makeEntry(1));
		t(makeEntry(2));

		expect(calls.length).toBe(0);

		await vi.advanceTimersByTimeAsync(100);
		// give pending microtasks a chance
		await Promise.resolve();

		expect(calls.length).toBe(1);
		expect(calls[0]?.url).toBe("http://localhost/telemetry");
		expect(calls[0]?.init?.method).toBe("POST");

		const body = String(calls[0]?.init?.body);
		expect(body).toContain('"entries"');
		expect(body).toContain('"m1"');
		expect(body).toContain('"m2"');

		t.stop();
	});

	it("flushes immediately when maxBatch reached", async () => {
		const calls: Array<{ body: string }> = [];
		const fetchFn = async (_url: any, init?: any) => {
			calls.push({ body: String(init?.body) });
			return new Response(null, { status: 204 });
		};

		const t = httpBatchTransport({
			url: "http://localhost/telemetry",
			flushIntervalMs: 0, // disable timer
			maxBatch: 2,
			fetchFn,
			flushOnUnload: false,
		});

		t(makeEntry(1));
		expect(calls.length).toBe(0);

		t(makeEntry(2));
		// flush triggered fire-and-forget; wait a tick
		await Promise.resolve();

		expect(calls.length).toBe(1);
		expect(calls[0]?.body).toContain('"m1"');
		expect(calls[0]?.body).toContain('"m2"');

		t.stop();
	});

	it("applies backpressure via maxQueue (dropOldest=true)", async () => {
		const calls: Array<{ body: string }> = [];
		const fetchFn = async (_url: any, init?: any) => {
			calls.push({ body: String(init?.body) });
			return new Response(null, { status: 204 });
		};

		const t = httpBatchTransport({
			url: "http://localhost/telemetry",
			flushIntervalMs: 0,
			maxBatch: 10,
			maxQueue: 2,
			dropOldest: true,
			fetchFn,
			flushOnUnload: false,
		});

		t(makeEntry(1));
		t(makeEntry(2));
		t(makeEntry(3)); // should drop m1, keep m2+m3

		await t.flush();

		expect(calls.length).toBe(1);
		const body = calls[0]?.body;

		expect(body).not.toContain('"m1"');
		expect(body).toContain('"m2"');
		expect(body).toContain('"m3"');

		t.stop();
	});

	it("supports mapEntry transform", async () => {
		const calls: Array<{ body: string }> = [];
		const fetchFn = async (_url: any, init?: any) => {
			calls.push({ body: String(init?.body) });
			return new Response(null, { status: 204 });
		};

		const t = httpBatchTransport({
			url: "http://localhost/telemetry",
			flushIntervalMs: 0,
			maxBatch: 2,
			fetchFn,
			flushOnUnload: false,
			mapEntry: (entry) => ({
				ts: entry.ts,
				kind: entry.record.kind,
				msg: entry.record.kind === "log" ? entry.record.msg : entry.record.name,
			}),
		});

		t(makeEntry(1));
		t(makeEntry(2));
		await Promise.resolve();

		expect(calls.length).toBe(1);
		const body = calls[0]?.body;
		expect(body).toContain('"kind":"log"');
		expect(body).toContain('"msg":"m1"');

		t.stop();
	});
});
