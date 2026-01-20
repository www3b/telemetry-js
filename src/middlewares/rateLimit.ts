import type { Envelope, LogLevel, Middleware } from "../core/types";

export type RateLimitWindow = {
  /**
   * How many entries are allowed per interval.
   * Example: { limit: 10, intervalMs: 1000 } means ~10/sec.
   */
  limit: number;

  /**
   * Interval size in milliseconds.
   */
  intervalMs: number;

  /**
   * Burst capacity (token bucket capacity).
   * Defaults to `limit`.
   */
  burst?: number;
};

export type RateLimitOptions = {
  /**
   * Per-level rate limits for logs.
   * If a level is not provided, it falls back to `defaultLog` (if set), otherwise unlimited.
   */
  log?: Partial<Record<LogLevel, RateLimitWindow>>;

  /**
   * Per-event-name rate limits.
   * Use "*" as wildcard fallback.
   */
  event?: Record<string, RateLimitWindow>;

  /**
   * Fallback if log level has no rule.
   */
  defaultLog?: RateLimitWindow;

  /**
   * Fallback if event name has no rule and "*" is not provided.
   */
  defaultEvent?: RateLimitWindow;

  /**
   * Optional key function. If provided, rate limiting will be isolated per key.
   * Example: key: (entry) => entry.ctx.userId ?? entry.ctx.requestId
   */
  key?: (entry: Envelope) => string | number | undefined;

  /**
   * Time source for tests. Defaults to Date.now.
   */
  now?: () => number;

  /**
   * Safety valve: maximum number of buckets stored.
   * When exceeded, oldest buckets are evicted (LRU-ish).
   */
  maxBuckets?: number;

  /**
   * Buckets not used for this long are removed (ms).
   */
  bucketTtlMs?: number;
};

type Bucket = {
  tokens: number;
  updatedAt: number; // last token update time
  lastSeen: number;  // last access time (for TTL/LRU)
};

export function rateLimit(options: RateLimitOptions): Middleware {
  const pickKey = options.key;
  const now = options.now ?? Date.now;
  const maxBuckets = options.maxBuckets ?? 10_000;
  const bucketTtlMs = options.bucketTtlMs ?? 10 * 60_000; // 10 minutes

  // Map key is: `${scopeKey}::${ruleKey}` where scopeKey depends on `options.key`
  const buckets = new Map<string, Bucket>();

  let ops = 0;

  return (entry, next) => {
    const rule = pickRule(entry, options);
    if (!rule) {
      // unlimited
      return next();
    }

    const scopeKey = pickKey ? pickKey(entry) : undefined;
    const scope = scopeKey === undefined ? "global" : String(scopeKey);

    const ruleKey = entry.record.kind === "log"
      ? `log:${entry.record.level}`
      : `event:${entry.record.name}`;

    const bucketId = `${scope}::${ruleKey}`;
    const t = now();

    // Periodic cleanup (cheap, avoids doing it every call)
    if (++ops % 200 === 0) {
      cleanup(buckets, t, bucketTtlMs, maxBuckets);
    }

    // TTL cleanup for the specific bucket (common case)
    const existing = buckets.get(bucketId);
    if (existing && t - existing.lastSeen > bucketTtlMs) {
      buckets.delete(bucketId);
    }

    const b = buckets.get(bucketId) ?? createBucket(rule, t);
    touchLRU(buckets, bucketId, b, t);

    refill(b, rule, t);

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return next();
    }

    // drop: do not call next()
  };
}

function pickRule(entry: Envelope, options: RateLimitOptions): RateLimitWindow | undefined {
  if (entry.record.kind === "log") {
    const byLevel = options.log?.[entry.record.level];
    return byLevel ?? options.defaultLog;
  }

  const byName = options.event?.[entry.record.name];
  if (byName) {
    return byName;
  }

  const wildcard = options.event?.["*"];

  return wildcard ?? options.defaultEvent;
}

function createBucket(rule: RateLimitWindow, t: number): Bucket {
  const cap = Math.max(0, rule.burst ?? rule.limit);
  return {
    tokens: cap,
    updatedAt: t,
    lastSeen: t
  };
}

function refill(bucket: Bucket, rule: RateLimitWindow, t: number): void {
  const cap = Math.max(0, rule.burst ?? rule.limit);
  const limit = Math.max(0, rule.limit);
  const intervalMs = Math.max(1, rule.intervalMs);

  // tokens per ms
  const rate = limit / intervalMs;

  const dt = t - bucket.updatedAt;
  if (dt <= 0 || rate <= 0) {
    bucket.updatedAt = t;
    return;
  }

  bucket.tokens = Math.min(cap, bucket.tokens + dt * rate);
  bucket.updatedAt = t;
}

function cleanup(
  buckets: Map<string, Bucket>,
  now: number,
  bucketTtlMs: number,
  maxBuckets: number
): void {
  // TTL cleanup
  for (const [id, b] of buckets) {
    if (now - b.lastSeen > bucketTtlMs) {
      buckets.delete(id);
    }
  }

  // Size cleanup
  while (buckets.size > maxBuckets) {
    const firstKey = buckets.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    buckets.delete(firstKey);
  }
}

function touchLRU(buckets: Map<string, Bucket>, id: string, bucket: Bucket, t: number): void {
  bucket.lastSeen = t;

  // Move to the end to approximate LRU (Map keeps insertion order)
  if (buckets.has(id)) {
    buckets.delete(id);
  }
  buckets.set(id, bucket);
}
