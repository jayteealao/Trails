---
schema: sdlc/v1
type: implement-index
slug: simplify-android-app
status: in-progress
stage-number: 5
created-at: "2026-06-18T22:04:03Z"
updated-at: "2026-07-05T21:48:10Z"
slices-implemented: 3
slices-total: 14
metric-total-files-changed: 11
metric-total-lines-added: 985
metric-total-lines-removed: 198
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
slices:
  - slice: test-net
    file: 05-implement-test-net.md
    status: complete
  - slice: fts-search-fix
    file: 05-implement-fts-search-fix.md
    status: complete
  - slice: streaming-restore
    file: 05-implement-streaming-restore.md
    status: complete
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app streaming-restore"
---

# Implement Index

Tracks per-slice implementation across the 14-slice refactor. `test-net` is the
foundational regression-net gate — every dependent slice waits on it being green.

| Slice | Status | Record |
|-------|--------|--------|
| test-net | complete | [05-implement-test-net.md](05-implement-test-net.md) |
| fts-search-fix | complete | [05-implement-fts-search-fix.md](05-implement-fts-search-fix.md) |
| streaming-restore | complete | [05-implement-streaming-restore.md](05-implement-streaming-restore.md) |

## Cross-Slice Integration Notes
- **`test-net` is a prerequisite, not a peer.** Its characterization tests pin the
  CURRENT behaviour of `FirestoreSyncManager`/`FirestoreBackupService`. The dependent
  slices that change that behaviour — `firestore-dedup`, `firestore-io`,
  `batched-tag-reads` — must update any marked assertions when they land; the inline
  comments in the test files flag exactly which assertions move.
- **`streaming-restore` set the final public API of `restoreAllArticlesPaginated`.**
  `firestore-dedup` must not further change this function's signature. `firestore-io`
  and `batched-tag-reads` target different surfaces and are not in conflict.
- **`streaming-restore` replaced the old accumulation characterization test** in
  `FirestoreBackupServiceTest` with 8 new streaming-shape tests (A2 + A2b). The 13
  pre-existing tests are unchanged and green.
- **Build-config note for later slices:** Hilt annotation processing is now uniformly
  KSP across main/test/androidTest (the redundant kapt registrations were removed). Any
  future test `@Module` should rely on KSP; do not re-add `kaptAndroidTest`/`kaptTest`
  Hilt compilers.
- **Pre-existing red test:** `data/archive/ArchiveServiceTest.kt` has 3 failures on
  `main` unrelated to this workflow. Slug-wide review/verify should not attribute it to
  any slice here.

## Recommended Next Stage
- **Option A (default):** `/wf verify simplify-android-app streaming-restore` — AC gate for the streaming-restore slice.
- **Option B:** `/wf verify simplify-android-app fts-search-fix` — if the fts-search-fix verify is still open.
- **Option C:** `/wf implement simplify-android-app batched-tag-reads` — next dependent slice.
