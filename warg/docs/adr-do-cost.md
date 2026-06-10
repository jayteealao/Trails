# Decision record: cutting warg's Durable Objects duration cost

Status: accepted (2026-06)
Scope: monolith container lifecycle, LoggerDO keying scheme

## Problem

The Cloudflare bill spiked ~16× on the **Durable Objects duration** meter
(GB-seconds active), from the ~$5 Workers Paid base to ~$18–22/month. The
free allowance is 400k GB-s/month; GB-s ≈ invocations × wall-time × 0.128 GB
(DOs bill at a fixed 128 MB regardless of real memory).

The DO dashboard (30 days) settled which namespaces drive the meter:

| DO namespace | Requests (30d) | Why it bills |
|---|---|---|
| monolith (Sandbox container DO) | 204k (59%) | longest wall times — the archive binary runs here |
| logger (LoggerDO) | 129k (37%) | one cold-started instance per request |
| workflow (BrowserQuotaDO) | 14k (4%) | hibernates between alarms; negligible |

Two billing facts shaped the fix:

1. **Cloudflare Workflows do not bill DO duration to the customer** — they
   bill CPU-ms (30M/month free) plus storage. Tightening workflow retry loops
   is a CPU/latency lever, not a GB-s lever.
2. **Every container carries a backing DO billed at standard DO rates**, on
   top of container compute (memory billed on *provisioned* size). A container
   held alive is a DO accruing duration the whole time.

## Decision 1: stop the monolith container per job (primary lever)

The monolith worker previously pinned jobs to a warm pool of up to 5
containers (`monolith-pool-<slot>`) with **no explicit stop and no
`sleepAfter` configured** — the upstream Sandbox default keeps a container
alive 10 minutes after its last activity, and pool reuse kept resetting that
timer. Idle containers were the dominant GB-s driver.

Now, three layers guarantee containers do not outlive their job:

1. **`stop()` per job** — `runMonolithInSandbox` keys the sandbox off the
   request id and stops it in a `finally` block, on success and on error. A
   failed `stop()` is logged and never masks the job's own outcome.
2. **5m `sleepAfter` backstop** — the `Sandbox` subclass in
   `workers/monolith/src/index.ts` sets `sleepAfter = '5m'` (wrangler's
   `containers` config exposes no such key, so the class field is the
   configuration surface). The value must exceed the longest job (P99 ~180s)
   because the inactivity alarm can fire during an in-flight exec
   (cloudflare/containers#162) — `'5m'` clears that tail with margin.
   Cost note: at a 1% `stop()` miss rate, orphaned containers idle up to 5
   minutes before reaping, contributing ~21 GB-s/month — negligible versus
   the 400k GB-s/month free tier.
3. **Cron orphan sweep** — the gateway's existing 10-minute cron also calls
   the workflow worker for active sandbox quota leases and asks the monolith
   worker (`POST /container/stop`) to stop the container behind any lease
   older than the 5-minute lease TTL (a lease that old means its workflow
   crashed before releasing).

Trade-off accepted: every job cold-starts a container. Cost is prioritized
over latency for this batch pipeline. The warm pool, its slot plumbing in the
workflow worker, and the pool-id validation in the monolith worker were
removed; `BrowserQuotaDO` still assigns slots internally (vestigial, cleanup
tracked separately).

## Decision 2: hour-bucketed LoggerDO (secondary lever)

LoggerDO was keyed `idFromName(requestId)` — one DO instance per request,
~129k cold starts per 30 days. It is now keyed by UTC hour bucket
(`bucket:YYYYMMDDHH`): roughly 24 warm instances per day replace ~4.3k
per-day cold starts (129k requests / 30 days). Measured write rates (~0.4/s
peak) are about 2,500×
below the per-instance throughput limit, so a single unsharded bucket per
hour suffices.

Consequences inside the DO:

- `events` and `artifacts` gained a `request_id` column (plus indexes); every
  method takes the request id and filters on it.
- A request's bucket is the hour of its `created_at`. The init handler picks
  the bucket and the stored `created_at` from the same timestamp; later
  writes and reads derive the bucket from the D1 index (`requests_index
  .created_at`) — request ids are UUIDs and encode no time, so this lookup is
  what makes reads routable.
- **Dual-read, no backfill:** pre-bucket requests still live in their legacy
  per-request instances. Readers try the creation-hour bucket first and fall
  back to the legacy instance when the bucket holds no row. On first access a
  legacy instance migrates its own rows in place (adds `request_id`, adopts
  rows under its single request). Legacy instances are never written by new
  code, except `PATCH /request/:id` which follows the data for requests that
  were mid-flight at cutover.

### Why hour buckets over Workers Analytics Engine

Moving the event store to WAE was rejected: it is operationally irreversible
(append-only, external store), its billing is not yet active (pricing risk),
and the SSE stream would need a write-through buffer anyway. The bucket
re-key keeps SQLite-in-DO semantics, is reversible by redeploying the old
keying (legacy data is untouched), and the container fix — not the logger —
is the dominant lever.

## Post-deploy observations to track

(a) **SSE stream keep-alive** — each active SSE poll (`GET /request/:id/stream`)
holds a LoggerDO awake for up to 2 minutes. When many dashboard tabs are open,
the logger namespace wall-time will exceed the 24-instance baseline. Watch the
logger DO wall-time metric when dashboards are in use.

(b) **D1 routing read** — every post-init logger write does one D1 point-read
(`SELECT created_at FROM requests_index`) to resolve the bucket. At ~129k
requests/month that is ~129k reads/month, well under the 150M/month free tier.
Revisit if request volume grows ~10×.

(c) **Gateway cron sub-request** — the 10-minute orphan cron makes one
sandbox-leases sub-request to the workflow worker per tick, regardless of load.
The request count is negligible (~4,320/month).

## Rollback

- **Container lifecycle:** revert the `finally`/`stop()` block, the
  `sleepAfter = '5m'` field, and re-add warm-pool slot passing. Redeploy.
- **Logger keying:** point writes back at `idFromName(requestId)` and drop
  the dual-read. Redeploy. Bucket-era requests then need the same dual-read
  in reverse, so this is a fast-failure escape hatch, not a free undo.

## Verification

- Unit/integration tests cover `stop()` on success/error/upload-failure
  paths, the sweep logic, bucket multi-request isolation, legacy migration,
  and dual-read fallbacks.
- Post-deploy: the DO dashboard's `monolith` namespace wall-time should drop
  to near zero between jobs, and `logger` invocations should fall from
  thousands per day toward one warm instance per active hour.
- The decisive check is the next invoice: DO duration back under
  400k GB-s/month.
