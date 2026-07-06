---
schema: sdlc/v1
type: implement-index
slug: simplify-android-app
status: complete
stage-number: 5
created-at: "2026-06-18T22:04:03Z"
updated-at: "2026-07-06T01:33:19Z"
slices-implemented: 15
slices-total: 15
metric-total-files-changed: 57
metric-total-lines-added: 2505
metric-total-lines-removed: 1063
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
  - slice: batched-tag-reads
    file: 05-implement-batched-tag-reads.md
    status: complete
  - slice: app-scope
    file: 05-implement-app-scope.md
    status: complete
  - slice: firestore-dedup
    file: 05-implement-firestore-dedup.md
    status: complete
  - slice: firestore-io
    file: 05-implement-firestore-io.md
    status: complete
  - slice: article-repository
    file: 05-implement-article-repository.md
    status: complete
  - slice: detail-viewmodel
    file: 05-implement-detail-viewmodel.md
    status: complete
  - slice: list-viewmodel
    file: 05-implement-list-viewmodel.md
    status: complete
  - slice: list-rendering
    file: 05-implement-list-rendering.md
    status: complete
  - slice: sync-worker
    file: 05-implement-sync-worker.md
    status: complete
  - slice: cross-cutting-url
    file: 05-implement-cross-cutting-url.md
    status: complete
  - slice: architecture-docs
    file: 05-implement-architecture-docs.md
    status: complete
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app architecture-docs"
---

# Implement Index

Tracks per-slice implementation across the 14-slice refactor. `test-net` is the
foundational regression-net gate — every dependent slice waits on it being green.

| Slice | Status | Record |
|-------|--------|--------|
| test-net | complete | [05-implement-test-net.md](05-implement-test-net.md) |
| fts-search-fix | complete | [05-implement-fts-search-fix.md](05-implement-fts-search-fix.md) |
| streaming-restore | complete | [05-implement-streaming-restore.md](05-implement-streaming-restore.md) |
| batched-tag-reads | complete | [05-implement-batched-tag-reads.md](05-implement-batched-tag-reads.md) |
| app-scope | complete | [05-implement-app-scope.md](05-implement-app-scope.md) |
| firestore-dedup | complete | [05-implement-firestore-dedup.md](05-implement-firestore-dedup.md) |
| firestore-io | complete | [05-implement-firestore-io.md](05-implement-firestore-io.md) |
| article-repository | complete | [05-implement-article-repository.md](05-implement-article-repository.md) |
| detail-viewmodel | complete | [05-implement-detail-viewmodel.md](05-implement-detail-viewmodel.md) |
| list-viewmodel | complete | [05-implement-list-viewmodel.md](05-implement-list-viewmodel.md) |
| list-rendering | complete | [05-implement-list-rendering.md](05-implement-list-rendering.md) |
| sync-worker | complete | [05-implement-sync-worker.md](05-implement-sync-worker.md) |
| cross-cutting-url | complete | [05-implement-cross-cutting-url.md](05-implement-cross-cutting-url.md) |
| architecture-docs | complete | [05-implement-architecture-docs.md](05-implement-architecture-docs.md) |

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
- **Option A (default):** `/wf verify simplify-android-app cross-cutting-url` — 4 new unit tests cover the extension delegation contract; verify runs `testDebugUnitTest --tests "com.jayteealao.trails.common.*"` (all 20 pass) and full-suite green (147/0 failures).
- **Option B:** `/wf review simplify-android-app cross-cutting-url` — purely structural reuse change; tests already verified inline; skip to review if no additional verification needed.

### architecture-docs slice
- **Option A (default):** `/wf verify simplify-android-app architecture-docs` — verification is manual (leak check + accuracy review against shipped source). Both passed during implementation.
- **Option B:** `/wf review simplify-android-app architecture-docs` — docs-only slice; no automated tests; proceed directly to review.
