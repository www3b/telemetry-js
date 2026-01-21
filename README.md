# telemetry-js

Lightweight telemetry library for logs and events, designed for browser and Node.js environments.


## Reason

In web applications, telemetry often grows organically:

- logs are scattered across the codebase
- context propagation becomes inconsistent
- debugging becomes difficult

This library focuses on:

- explicit context propagation
- controlled volume (sampling, rate limiting, deduplication)
- best-effort delivery that never blocks application logic
- small surface area and readable code



## Core concepts

### Entry (Envelope)

Every telemetry record is wrapped into an `Envelope`:

- timestamp
- context (`ctx`)
- record (`log` or `event`)

The envelope flows through the pipeline and may be modified by middlewares.

---

### Context

Context is a plain object attached to every entry.

Typical examples:

- `requestId`
- `userId`
- `route`
- `app`, `env`, `release`

Context is:

- merged explicitly
- propagated through async boundaries (best-effort in browsers)
- available to all middlewares and transports

---

### Pipeline

Telemetry is processed through a pipeline:

emit → middleware1 → middleware2 → … → transport


Middlewares may:

- modify the entry
- enhance context
- drop entries
- throttle or deduplicate

If a middleware does **not** call `next()`, the entry is dropped.

---

## Installation

```bash
npm install telemetry-js
```

## Basic usage

```typescript
import { createTelemetry } from "telemetry-js";

const telemetry = createTelemetry({
  app: "my-app",
  env: "production"
});

telemetry.log.info("app started");
telemetry.track("page_view", { path: "/" });

```

## Context propagation

### Global context

```typescript
telemetry.setGlobalContext({
  app: "my-app",
  env: "prod"
});
```

### Scoped context

```typescript
telemetry.withScope({ requestId: "r1" }, () => {
  telemetry.log.info("inside request");
});
```

---

## Middlewares

Middlewares are applied in the order they are registered.



`meta`

Adds metadata to entry.ctx.

```typescript
import { meta } from "telemetry-js";

telemetry.use(
  meta({
    meta: { app: "web" },
    includeTimestamp: true,
    includeRecordInfo: true,
    providers: [
      () => {
        return { route: window.location.pathname };
      }
    ]
  })
);
```

By default, metadata is merged directly into ctx.

---

`secret`

Removes sensitive data from context and payloads.

```typescript
import { secret } from 'telemetry-js';

telemetry.use(
  secret({
    keys: ["token", "password", "authorization"]
  })
);
```

Result:

```json
{
    "visible-field": "example",
    "token": "[MASKED]",
    "password": "[MASKED]",
    "authorization": "[MASKED]"
}
```

---

`sample`

Probabilistic sampling.

```typescript
telemetry.use(
  sample({
    log: {
      debug: 0.05,
      info: 1
    },
    event: {
      "*": 0.2,
      page_view: 1
    },
    key: (entry) => entry.ctx.userId
  })
);
```

Rates are probabilities:

- 1 → keep all

- 0.5 → keep ~50%

- 0.05 → keep ~5%

When a key is provided, sampling becomes deterministic per key.

---

`rateLimit`

Protects against log or event DOS.

```typescript
telemetry.use(
  rateLimit({
    log: {
      debug: { limit: 10, intervalMs: 1000 }
    },
    event: {
      "*": { limit: 100, intervalMs: 1000 }
    },
    key: (entry) => entry.ctx.requestId
  })
);
```

---

`dedupe`

Drops repeated entries within a TTL window.

```typescript
telemetry.use(
  dedupe({
    ttlMs: 10_000,
    key: (entry) => entry.ctx.requestId
  })
);
```

Useful for collapsing repeated errors or identical events.

---


## Transports

### Console transport

Show logs and events in browser console or node terminal / CLI

```typescript
import { consoleTransport } from "telemetry-js";

telemetry.addTransport(consoleTransport());
```

### HTTP batch transport

Send logs and events in http batches

```typescript
import { httpBatchTransport } from "telemetry-js";

telemetry.addTransport(
  httpBatchTransport({
    url: "/api/telemetry",
    flushIntervalMs: 2000,
    maxBatch: 50,
    retry: {
      retries: 3,
      baseDelayMs: 250
    }
  })
);
```

Features:
- in-memory batching

- size-based and timer-based flush

- retry with exponential backoff

- best-effort flush on page unload
