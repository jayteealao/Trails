# monolith

Produces self-contained `monolith.html` from rendered HTML, running the
monolith binary inside a Cloudflare Sandbox container. Internal worker
(`X-Internal-API-Key` required).

## Container lifecycle

Containers bill Durable Object duration the entire time they are alive, so
they are stopped per job — there is no warm pool. Sandboxes are keyed off the
request id (`normalizeSandboxId(requestId)`), and each job cold-starts its
container. Rationale and cost numbers:
[`docs/adr-do-cost.md`](../../docs/adr-do-cost.md).

Three layers guarantee shutdown:

1. **`stop()` per job** — `runMonolithInSandbox` wraps execution in
   `try/finally` and stops the sandbox on success and on error. A failing
   `stop()` is logged (`[monolith] stop() failed (non-fatal)`) and never
   masks the job's outcome.
2. **5m `sleepAfter` backstop** — the `Sandbox` subclass exported from
   `src/index.ts` sets `sleepAfter = '5m'` (upstream default is 10 minutes).
   The value must exceed the longest job (P99 ~180s) because the inactivity
   alarm fires even during an in-flight exec (cloudflare/containers#162).
   Wrangler's `containers` config has no `sleep_after` key; the class field
   is the configuration surface.
3. **Cron orphan sweep** — the gateway's 10-minute cron stops containers
   behind sandbox quota leases that outlived the 5-minute lease TTL, via
   `POST /container/stop` here.

## Endpoints

| Route | Notes |
|---|---|
| `POST /monolith` | `{ request_id, rendered_html_key, base_url }` → runs the job; HTML moves via presigned R2 URLs, never through worker RPC |
| `POST /container/stop` | `{ request_id }` → stops that request's container; used by the gateway sweep |

## Tests

```bash
pnpm --filter @warg/monolith test
```

`monolith-lifecycle.test.ts` asserts `stop()` fires exactly once on the
success, exec-failure, and upload-failure paths, and that `stop()` failures
mask nothing.
