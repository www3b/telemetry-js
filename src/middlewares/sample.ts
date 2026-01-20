import type { Envelope, Middleware } from "../core/types";

export type SampleConfig = {
  /**
   * Sampling rates for logs by level. 1 = keep all, 0 = drop all.
   * Example: { debug: 0.05, info: 1, warn: 1, error: 1 }
   */
  log?: Partial<Record<"debug" | "info" | "warn" | "error", number>>;

  /**
   * Sampling rates for events by name.
   * Use "*" as default fallback.
   * Example: { "*": 0.2, "page_view": 1 }
   */
  event?: Record<string, number>;

  /**
   * Optional deterministic key. If provided, sampling will be consistent for the same key.
   * Example: entry.ctx.requestId or userId (if available).
   */
  key?: (entry: Envelope) => string | number | undefined;

  /**
   * RNG injection. Defaults to Math.random.
   */
  random?: () => number;
};

export function sample(config: SampleConfig): Middleware {
  const logRates = config.log ?? {};
  const eventRates = config.event ?? {};
  const pickKey = config.key;
  const rnd = config.random ?? Math.random;

  return (entry, next) => {
    const rate = getRate(entry, logRates, eventRates);
    if (rate >= 1) {
      return next();
    }
    if (rate <= 0) {
      return;
    }

    // Deterministic sampling if key() provided
    if (pickKey) {
      const key = pickKey(entry);
      if (key !== undefined) {
        const u = hashToUnitInterval(String(key));
        if (u < rate) return next();
        return;
      }
    }

    if (rnd() < rate) {
      return next();
    }
  };
}

function getRate(
  entry: Envelope,
  logRates: Partial<Record<"debug" | "info" | "warn" | "error", number>>,
  eventRates: Record<string, number>
): number {
  if (entry.record.kind === "log") {
    const v = logRates[entry.record.level];
    return clamp01(v ?? 1);
  }

  const exact = eventRates[entry.record.name];
  if (exact !== undefined) {
    return clamp01(exact);
  }

  const wildcard = eventRates["*"];
  return clamp01(wildcard ?? 1);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) {
    return 0;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

function hashToUnitInterval(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // convert to unsigned and normalize
  const u32 = h >>> 0;
  return u32 / 2 ** 32;
}
