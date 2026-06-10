# logger

Event-sourced request traces. Internal worker (service-bound, `X-Internal-API-Key`
on every route). Authoritative store is SQLite inside Durable Objects; the D1
`requests_index` table is a derived index for list/stats reads.

## Durable Object keying: hour buckets

`LoggerDO` instances are keyed by UTC hour: `bucket:YYYYMMDDHH`
(`bucketKeyForTs` in `src/bucket-key.ts`). Every request initialized in that hour
lives in the same instance — roughly 24 warm instances per day instead of one
cold-started instance per request. Rationale and cost numbers:
[`docs/adr-do-cost.md`](../../docs/adr-do-cost.md).

A request belongs to the bucket of its `created_at` hour, fixed at init time:
`POST /request/init` derives the bucket key and the stored `created_at` from
the same timestamp, so they can never disagree across an hour boundary.

### Routing

- **Writes after init** (`POST /event`, `POST /events/batch`, `POST /artifact`):
  look up `requests_index.created_at` in D1, derive the bucket, write there.
  If D1 has no row (its best-effort insert failed), the write falls back to the
  current-hour bucket rather than being dropped — a data-locality trade-off
  accepted over event loss.
- **Reads** (`GET /request/:id`, `/events`, `/stream`): same D1-derived
  bucket first; if the bucket returns no row for the request id, fall back to
  the **legacy per-request instance** (`idFromName(requestId)`, the
  pre-bucket scheme). No backfill is performed — old traces stay where they
  are and remain readable.
- **`PATCH /request/:id`**: bucket first, then legacy — the only write path
  allowed to touch a legacy instance, so requests mid-flight at cutover can
  still record their manifest key.

### Schema

`events` and `artifacts` carry a `request_id` column (indexed); all DO
methods take the request id and filter on it. `migrateSchema` (run from
`ensureSchema` on every instance start) upgrades legacy instances in place:
adds the columns and adopts existing rows under the instance's single
request. It is idempotent.

## Endpoints

| Route | Notes |
|---|---|
| `POST /request/init` | creates request row + D1 index row |
| `POST /event` | appends a single event, replays derived summary |
| `POST /events/batch` | atomically appends up to 100 events in one DO round-trip; body `{ requestId, events[] }`; returns `{ eventIds, derivedUpdated }`; terminal events are sent per-event by design |
| `POST /artifact` | upserts artifact metadata |
| `PATCH /request/:id` | manifest key / external json; returns **404** for unknown request ids |
| `GET /request/:id` | canonical view (dual-read); returns **404** for unknown request ids |
| `GET /request/:id/events` | paginated events (dual-read); returns **200 `{ events: [] }`** for unknown ids (intentional historical wire shape — `GET /request/:id` is the authoritative existence check) |
| `GET /request/:id/stream` | SSE, 3s poll, 2-minute cap (dual-read) |
| `GET /requests`, `GET /stats`, `POST /requests/batch` | served from D1 index |
| `POST /maintenance/backfill-diagnostics` | recompute legacy diagnostics (dual-read) |

## Tests

```bash
pnpm --filter @warg/logger test
```

Runs under `@cloudflare/vitest-pool-workers` with real DO instances,
including bucket multi-request isolation and the legacy-instance migration.
