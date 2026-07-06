---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: architecture-docs
status: complete
stage-number: 5
created-at: "2026-07-06T01:33:19Z"
updated-at: "2026-07-06T01:33:19Z"
metric-files-changed: 4
metric-lines-added: 225
metric-lines-removed: 1
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "c3b2064"
tags: [docs, diataxis]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-architecture-docs.md
  plan: 04-plan-architecture-docs.md
  siblings:
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-fts-search-fix.md
    - 05-implement-article-repository.md
    - 05-implement-detail-viewmodel.md
    - 05-implement-list-viewmodel.md
    - 05-implement-list-rendering.md
    - 05-implement-sync-worker.md
    - 05-implement-cross-cutting-url.md
  verify: 06-verify-architecture-docs.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app architecture-docs"
---

# Implement: Diátaxis documentation

## The Implementation

Three Markdown files land in `docs/architecture/` — one for the Firestore sync/backup
layer, one for the app-scope DI conventions, one as a reference for the batched-tag-read
query shape — plus a single sentence added to the README Android client description.
All four files were authored against the shipped source code (read in full before writing),
not against the upstream plan text, to guard against drift introduced during the structural
slices.

The one material deviation from the plan is in the `batchRestoreArticleTags` description:
the shipped implementation dispatches all async reads concurrently within a single
`coroutineScope` (chunk size only controls iteration batch size, not sequential rounds),
rather than `ceil(N/10)` sequential round-trips as the plan described. The reference doc
describes the actual behavior. The leak check confirmed zero SDLC vocabulary in the
published docs.

## Summary of Changes

- `docs/architecture/firestore-sync-backup.md` (NEW) — explanation of the sync/backup
  layer: collection layout, auth guard split, write path with large-text branch,
  `applyRemoteArticles` sync deduplication, streamed-restore memory contract with
  `suspend onPage` callback, large-text rehydration (A2b), batched tag reads summary,
  and FTS search fix with result-set impact.
- `docs/architecture/app-scope-di.md` (NEW) — explanation of `@ApplicationScope`,
  why `SupervisorJob()` is required, when to use app scope vs `viewModelScope`, why
  `cleanup()` must not cancel the shared scope, and the anti-pattern of constructing
  an unmanaged scope in a `@Singleton`.
- `docs/architecture/batched-tag-reads.md` (NEW) — reference: function signature,
  query shape, why `collectionGroup` was rejected (three bullets), chunk size guidance,
  and distinction from the single-article `restoreArticleTags` path.
- `README.md` (MODIFIED) — one sentence added to the Android client row describing
  the FTS correction and restore memory contract.

## Files Changed

- `docs/architecture/firestore-sync-backup.md` — NEW; explanation doc for the
  Firestore sync/backup architecture post-cleanup
- `docs/architecture/app-scope-di.md` — NEW; explanation doc for app-scope coroutine
  scope and DI conventions
- `docs/architecture/batched-tag-reads.md` — NEW; reference doc for bulk tag read
  query shape and client-only rationale
- `README.md` — MODIFIED; one sentence added to Android client description

## Shared Files (also touched by sibling slices)

- `README.md` — the cross-cutting-url slice did not touch the README; no conflict.

## Notes on Design Choices

**Concurrent-read description accuracy:** The plan described `batchRestoreArticleTags`
as `ceil(N/10)` parallel round-trips. The shipped code uses `.chunked(10).flatMap { chunk -> chunk.map { async { } } }.awaitAll()` — all async jobs are started
concurrently within a single `coroutineScope`, then awaited together. This is more
concurrent than the plan described (all N reads in flight, not N/10 per round). The
reference doc describes the actual implementation.

**README scope:** The README is a monorepo overview. Only the two user-visible/operator-
visible changes (FTS correction and streaming restore memory bound) are mentioned there.
The deeper architectural rationale lives in `docs/architecture/`.

**Auth guard split documented explicitly:** The plan called for documenting
`withAuthenticatedUser` on FBS. The doc also notes explicitly that `FirestoreSyncManager`
uses a distinct pattern and explains why they are not unified, which is useful context
for any developer tempted to consolidate them.

## Verification Seams Built

None needed — documentation is verified by leak-check grep and manual accuracy review
against shipped source. No automated test seams are required or applicable.

## Visual Contract Honored

Not applicable — `02c-craft.md` is not present for this workflow.

## Deviations from Plan

1. **`batchRestoreArticleTags` concurrency model:** The plan described `ceil(N/10)`
   sequential round-trips. The shipped code dispatches all N reads concurrently within
   one `coroutineScope`. The docs describe the actual behavior. This is a documentation
   accuracy correction, not a code change.

## Anything Deferred

None. The reference doc correctly reflects the client-only outcome (no collectionGroup,
no index, no schema migration). All sections in the plan outline are covered.

## Known Risks / Caveats

- **Docs drift:** The three files accurately describe the shipped code at the time of
  writing. If the Firestore sync layer is refactored in the future, the docs in
  `docs/architecture/` should be updated alongside the code changes.

## Freshness Research

No external web research required. All architectural decisions (streamed restore API,
client-only batched reads, supervised app scope, FTS sanitization fix) are resolved in
the structural slices and confirmed by reading the shipped source files directly.

## Assumptions

1. The structural slices implement the architecture described in their upstream plans
   without material deviation — confirmed by reading the shipped source in full before
   writing (Step 1 of the plan).
2. `docs/architecture/` did not exist before this slice — confirmed by filesystem check;
   only `docs/runbooks/` existed.
3. No markdown linter is configured at the repo root or in `android/` — confirmed;
   no linter found in CI config.
4. The README update is one line — honored.

## Recommended Next Stage

- **Option A (default):** Proceed to review for the architecture-docs slice. Verification
  for this slice is manual (leak check + accuracy review), both of which passed during
  implementation. A review pass confirms the docs meet quality and external-output-boundary
  standards before handoff.
- **Option B:** Skip directly to handoff if the docs are accepted as-is.
