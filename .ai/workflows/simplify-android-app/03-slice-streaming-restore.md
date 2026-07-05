---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: streaming-restore
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: l
depends-on: [test-net]
tags: [behaviour-change, resource-safety, restore]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-test-net.md, 03-slice-batched-tag-reads.md, 03-slice-firestore-io.md]
  plan: 04-plan-streaming-restore.md
  implement: 05-implement-streaming-restore.md
---

# Slice: Constant-memory streamed restore (efficiency-5 + A2b)

## Goal
Make paginated restore memory-bounded: write each page to Room as it arrives and do not
retain it, so restoring a large remote library on a new device no longer OOMs. Fold in the
adjacent large-text rehydration parity fix and remove the superseded restore method.

## Why This Slice Exists
`restoreAllArticlesPaginated` currently re-accumulates every page into one in-memory list —
defeating its own purpose and risking OOM on large libraries. This is a resource-safety item
the PO scoped as its own behaviour-changing slice. The streamed-API shape (`Flow<List<Article>>`
vs a `suspend` per-page callback) is **deferred to this slice's plan** with both call sites in view.

## Scope
- **In:**
  - Redesign `restoreAllArticlesPaginated` (or its successor) to stream: each page written to
    Room on arrival, not retained. API shape decided in plan.
  - **A2b:** rehydrate `>900KB` large text from the `text` subcollection in the bulk restore
    path (parity with single-article `restoreArticle`, which already does this).
  - **Hard cutover:** remove the deprecated `restoreAllArticles()` and update all in-app callers
    (per PO extra-scope item).
- **Out:** Tag-read batching (→ `batched-tag-reads` / A3); per-chunk batch-commit and bulk
  tag-delete on the write path (→ `firestore-io` / B2).

## Acceptance Criteria
- **A2** — Given a large remote library restored on a new device When restore runs Then memory
  stays bounded: each page is written to Room as it arrives and is not retained. Verify with a
  streaming-API test (no full-list accumulation) + a manual emulator restore smoke (memory
  profiler / logcat — no sustained heap growth across pages). `automated` + `interactive`
- **A2b** — Given a restored article whose text exceeded the `>900KB` inline limit When bulk
  restore runs Then its large text is rehydrated from the `text` subcollection. `automated`

## Dependencies on Other Slices
- `test-net`: characterization tests pin current `FirestoreBackupService` behaviour first.

## Risks
- Edge cases (shape): zero articles; single page; page-write failure mid-stream (partial-restore
  state); cancellation; the `>900KB` rehydration path.
- Changing the restore API without auditing all callers could break the restore worker — hard
  cutover requires updating every in-app caller in this slice.
- Streamed shape choice (Flow vs callback) affects cancellation + backpressure semantics — plan
  must pick with both call sites open.
