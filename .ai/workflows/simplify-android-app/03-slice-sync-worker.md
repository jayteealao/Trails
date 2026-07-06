---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: sync-worker
status: defined
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: []
tags: [behaviour-preserving, worker, sync]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-firestore-dedup.md, 03-slice-streaming-restore.md]
  plan: 04-plan-sync-worker.md
  implement: 05-implement-sync-worker.md
---

# Slice: SyncWorker cleanup (B7)

## Goal
Make `SyncWorker` wait deterministically instead of polling, paginate its article load, and drop
its dead method and raw `getInstance()` — behaviour-preserving.

## Why This Slice Exists
Worker-area cleanup (by-code-area axis), independent of the other areas, so it can be planned in
parallel. The `delay(5000)` poll is both fragile and wasteful; `join()` is the correct primitive.

## Scope
- **In:**
  - **efficiency-9:** `syncJob.join()` instead of the `delay(5000)` poll.
  - **efficiency-11:** paginate the non-metrics article load (don't load everything at once).
  - **reuse-9 / quality-7:** remove the dead `syncArchivesInBackground` (or delegate to
    `ArchiveService`); drop the raw `getInstance()`.
- **Out:** The Firestore restore streaming (→ `streaming-restore`) and dedup (→ `firestore-dedup`);
  this slice is the worker glue only.

## Acceptance Criteria
- **B7** — Given `SyncWorker` runs When it waits for the sync job Then it uses `syncJob.join()` (no
  fixed `delay` poll); And its non-metrics article load is paginated; And the dead
  `syncArchivesInBackground` and raw `getInstance()` are gone — with no change to observable sync
  behaviour. `automated` + review

## Dependencies on Other Slices
- None hard. If `reuse-9` elects to delegate to `ArchiveService` rather than delete, confirm that
  path is live; otherwise remove (plan decides).

## Risks
- `join()` must wait on the correct job and preserve timeout/cancellation behaviour the `delay`
  poll implicitly provided (avoid hanging the worker).
- Pagination must not change which articles get synced, only how they're loaded.
