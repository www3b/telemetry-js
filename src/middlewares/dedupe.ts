import type { Envelope, Middleware } from "../core/types";

/**
 * Drops duplicate telemetry entries for a given TTL window.
 *
 * Semantics:
 * - first time a fingerprint is seen => passes through
 * - next time within ttlMs => dropped (next() not called)
 * - after ttlMs => passes again
 */
export type DedupeOptions = {
  /**
   * How long a fingerprint stays "hot" (ms).
   * Duplicates within this window are dropped.
   */
  ttlMs?: number;

  /**
   * Maximum number of fingerprints kept in memory.
   * When exceeded, oldest (least recently used) fingerprints are evicted.
   */
  maxSize?: number;

  /**
   * Optional scope key. If provided, dedupe is isolated per key.
   * Example: key: (entry) => entry.ctx.userId ?? entry.ctx.requestId
   */
  key?: (entry: Envelope) => string | number | undefined;

  /**
   * Optional custom fingerprint function.
   * Must return a reasonably stable string for "same" entries.
   */
  fingerprint?: (entry: Envelope) => string;

  /**
   * Time source for tests. Defaults to Date.now.
   */
  now?: () => number;

  /**
   * How often we run cleanup work (every N operations).
   */
  cleanupEvery?: number;

  /**
   * Limits how deep we inspect objects when building default fingerprints.
   */
  maxDepth?: number;

  /**
   * Limits how many characters we keep from a generated fingerprint.
   * Prevents unbounded memory usage due to huge payloads.
   */
  maxFingerprintLength?: number;
};

type CacheEntry = {
  expiresAt: number;
  lastSeen: number;
};

export function dedupe(options: DedupeOptions = {}): Middleware {
  const ttlMs = options.ttlMs ?? 10000;
  const maxSize = options.maxSize ?? 10000;
  const now = options.now ?? Date.now;
  const pickKey = options.key;
  const cleanupEvery = options.cleanupEvery ?? 200;
  const maxDepth = options.maxDepth ?? 10;
  const maxFingerprintLength = options.maxFingerprintLength ?? 2048;

  const makeFingerprint =
    options.fingerprint ??
    ((entry: Envelope) => {
      return defaultFingerprint(entry, maxDepth);
    });

  // Map preserves insertion order; we treat it as LRU by re-inserting on access.
  const cache = new Map<string, CacheEntry>();

  let ops = 0;

  return (entry, next) => {
    const t = now();

    ops += 1;
    if (ops % cleanupEvery === 0) {
      cleanup(cache, t, maxSize);
    }

    const scopeKey = pickKey ? pickKey(entry) : undefined;
    const scope = scopeKey === undefined ? "global" : String(scopeKey);

    let fp = makeFingerprint(entry);
    if (fp.length > maxFingerprintLength) {
      fp = fp.slice(0, maxFingerprintLength);
    }

    const id = `${scope}::${fp}`;

    const existing = cache.get(id);
    if (existing) {
      if (t < existing.expiresAt) {
        // drop
        existing.lastSeen = t;
        touchLRU(cache, id, existing);
        return;
      } else {
        // allow, refresh
        existing.expiresAt = t + ttlMs;
        existing.lastSeen = t;
        touchLRU(cache, id, existing);
        return next();
      }
    }

    // allow and store
    const ce: CacheEntry = { expiresAt: t + ttlMs, lastSeen: t };
    touchLRU(cache, id, ce);

    // Enforce max size
    if (cache.size > maxSize) {
      evictLRU(cache, maxSize);
    }

    return next();
  };
}

function cleanup(cache: Map<string, CacheEntry>, t: number, maxSize: number): void {
  // Remove expired entries
  for (const [id, ce] of cache) {
    if (t > ce.expiresAt) {
      cache.delete(id);
    }
  }

  if (cache.size > maxSize) {
    evictLRU(cache, maxSize);
  }
}

function evictLRU(cache: Map<string, CacheEntry>, maxSize: number): void {
  while (cache.size > maxSize) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

function touchLRU(cache: Map<string, CacheEntry>, id: string, ce: CacheEntry): void {
  if (cache.has(id)) {
    cache.delete(id);
  }
  cache.set(id, ce);
}

function defaultFingerprint(entry: Envelope, maxDepth: number): string {
  if (entry.record.kind === "log") {
    const base = `log:${entry.record.level}:${entry.record.msg}`;
    const dataPart = stableStringify(entry.record.data, maxDepth);
    const errPart = stableStringify(entry.record.err, maxDepth);
    return `${base}|data=${dataPart}|err=${errPart}`;
  }

  const base = `event:${entry.record.name}`;
  const propsPart = stableStringify(entry.record.props, maxDepth);
  return `${base}|props=${propsPart}`;
}

/**
 * Stable-ish stringify:
 * - sorts object keys
 * - respects maxDepth
 * - handles cycles
 * - produces deterministic output for "similar" objects
 */
function stableStringify(value: unknown, maxDepth: number): string {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): string => {
    if (depth > maxDepth) {
      return '"[MaxDepth]"';
    }

    const type = typeof v;

    if (v === null) {
      return "null";
    }

    if (type === "string") {
      return JSON.stringify(v);
    }

    if (type === "number") {
      if (Number.isFinite(v as number)) {
        return String(v);
      }
      return '"[NonFiniteNumber]"';
    }

    if (type === "boolean") {
      return (v as boolean) ? "true" : "false";
    }

    if (type === "undefined") {
      return '"[Undefined]"';
    }

    if (type === "bigint") {
      return JSON.stringify((v as bigint).toString());
    }

    if (type === "function") {
      return '"[Function]"';
    }

    if (type !== "object") {
      // symbol etc.
      return JSON.stringify(String(v));
    }

    if (v instanceof Error) {
      const name = v.name ?? "Error";
      const msg = v.message ?? "";
      const stack = v.stack ?? "";
      return `{"$error":${JSON.stringify(name)},"message":${JSON.stringify(msg)},"stack":${JSON.stringify(stack)}}`;
    }

    if (seen.has(v as object)) {
      return '"[Circular]"';
    }
    seen.add(v as object);

    if (Array.isArray(v)) {
      const parts: string[] = [];
      for (const item of v) {
        parts.push(walk(item, depth + 1));
      }
      return `[${parts.join(",")}]`;
    }

    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();

    const parts: string[] = [];
    for (const k of keys) {
      const vv = obj[k];
      parts.push(`${JSON.stringify(k)}:${walk(vv, depth + 1)}`);
    }

    return `{${parts.join(",")}}`;
  };

  return walk(value, 0);
}