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
3. **Stale-lease container stop** — the workflow's quota object, when it
   drops a sandbox lease that outlived the 5-minute lease TTL, asks this
   worker (`POST /container/stop`) to stop that container on its alarm.
   Failures are logged and not retried; the idle stop above stays the
   backstop.

## Endpoints

| Route | Notes |
|---|---|
| `POST /monolith` | `{ request_id, rendered_html_key, base_url }` → runs the job; `rendered_html_key` must be `archives/<request_id>/raw/rendered.html` (otherwise `400 INVALID_INPUT_KEY`). HTML moves through the Worker's R2 handler (`r2.monolith.internal`), never through worker RPC. A container that is not ready answers `503 MONOLITH_CONTAINER_UNAVAILABLE` (retryable) at once: the job does not wait or try the curl fallback, and the workflow step's retry delay does the waiting. A refused or failed R2 handler request answers `502 MONOLITH_R2_HANDLER_FAILED` (retryable only for an R2 `5xx`) |
| `POST /container/stop` | `{ request_id }` → stops that request's container; idempotent (`200 ok` when already stopped); called by the workflow's quota object |

## R2 access

The container holds no storage key. It reaches R2 at
`http://r2.monolith.internal/<key>`, and the platform hands requests to that
one host to this Worker, which answers them from its own `ARCHIVE_BUCKET`
binding (`src/r2-outbound.ts`). Every other host, such as the images and
stylesheets of the archived page, stays on the container's own network and
never passes through the Worker.

- Only two objects of the container's own request are reachable: `GET
  archives/<request_id>/raw/rendered.html` and `PUT
  archives/<request_id>/derived/monolith.html`. The request id must map to the
  calling container.
- Bodies stream in both directions, so the Worker never holds the whole page.
- Answers: `403` for any other key, method or container (no R2 read happens),
  `404` for a missing input, `411` for an upload without `Content-Length`,
  `502` when R2 itself fails.
- Each request logs one line, `[monolith] r2 handler`, with the method, host,
  request id, key and status (and the R2 error when R2 failed): a warning for
  a `403` or `411`, an error for a `5xx`, plain log otherwise.

The handler is registered as a static `outboundByHost` entry on the `Sandbox`
class, and the Worker exports `ContainerProxy`, which the platform needs to
deliver the intercepted requests.

## Diagnosing failures

The request diagnostics name the monolith failure by code. First checks:

- `MONOLITH_CONTAINER_UNAVAILABLE` — the sandbox container was not ready on
  every attempt. Search the monolith Worker logs for
  `ContainerUnavailableError: container not ready` and its `retryAfterMs`
  hint, and check the container capacity of the `Sandbox` binding.
- `MONOLITH_R2_HANDLER_FAILED` — the R2 handler refused (`403`, `404`, `411`)
  or R2 failed (`5xx`). Search the logs for `[monolith] r2 handler` lines of
  that request id: the status and, for a `5xx`, the R2 error.
- `MONOLITH_SANDBOX_500` — monolith itself failed inside the container; the
  Worker log `[monolith] Execution failed` holds its stderr.

## Configuration

Secrets: `INTERNAL_API_KEY` only. `MONOLITH_SERVICE_URL` is an optional
fallback URL. R2 is reached through the `ARCHIVE_BUCKET` binding; the Worker
holds no storage key. A live Worker deployed before this change still holds
the three R2 secrets of the old signed-URL path: retire them, and revoke the
R2 API token behind them, after the first clean archive, as "Retiring the
monolith Worker's R2 keys" in [`warg/README.md`](../../README.md) describes.

## Tests

```bash
pnpm --filter @warg/monolith test
```

`monolith-lifecycle.test.ts` asserts `stop()` fires exactly once on the
success, exec-failure, and upload-failure paths, and that `stop()` failures
mask nothing.
