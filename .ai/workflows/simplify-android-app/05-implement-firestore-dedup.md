---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: firestore-dedup
status: complete
stage-number: 5
created-at: "2026-07-05T22:58:12Z"
updated-at: "2026-07-05T22:58:12Z"
metric-files-changed: 3
metric-lines-added: 350
metric-lines-removed: 370
metric-deviations-from-plan: 2
metric-review-fixes-applied: 0
commit-sha: "c4cb3b163c656153dee90d825663df227e3a7661"
tags: [behaviour-preserving, firestore, dedup, reuse]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-firestore-dedup.md
  plan: 04-plan-firestore-dedup.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
  verify: 06-verify-firestore-dedup.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app firestore-dedup"
---

# Implement: Firestore sync/backup deduplication (B1)

## The Implementation

Five structural extractions collapsed the heaviest duplication in the Firestore persistence layer
with no behaviour change. The two files now share one canonical path for every repeated pattern:
large-text branching lives in `addArticleToBatch`, auth-guard boilerplate lives in
`withAuthenticatedUser`, the per-page apply loop lives in `applyRemoteArticles` (already extracted
by `batched-tag-reads`), and tag-backup during sync now routes through `backupArticle` instead of
a hand-rolled `firestore.batch()` per article.

The characterization suite from `test-net` stayed green throughout every step — that is the parity
proof for this behaviour-preserving slice. The one meaningful write-pattern change: the tag-backup
path in `syncLocalChanges` now also re-writes the article doc (idempotent via `SetOptions.merge()`)
and any markers alongside each tag set. This adds Firestore write bytes per article in that path
but is semantically identical; `firestore-io` (B2) will consolidate the commit-per-article pattern
in a future pass.

One planned step (`applyRemoteArticles`) was already fully in place when this slice landed —
`batched-tag-reads` implemented it with the more complete form (batch tag-prefetch + the single
extension point). No action was needed; the deviation is noted below.

## Summary of Changes

- **`FirestoreBackupService.kt`**: Added `addArticleToBatch` private helper (large-text branch
  extracted from two inline sites). Added `withAuthenticatedUser` private helper (auth guard
  extracted from 13 method sites). Both `backupArticle` and `backupArticlesPaginated` now delegate
  to `addArticleToBatch`. All public `Result<T>`-returning methods now delegate to
  `withAuthenticatedUser`. `batchRestoreArticleTags` was intentionally skipped (returns
  `Map<String, List<ArticleTags>>`, not `Result<T>`; its guard is already distinct).
- **`FirestoreSyncManager.kt`**: Deleted `USERS_COLLECTION` and `ARTICLES_COLLECTION` companion
  constants (dead after inline tag-batch removed). Removed `kotlinx.coroutines.tasks.await` import
  (no more `.await()` calls in this file). Tag-backup in `syncLocalChanges` delegates to
  `firestoreBackupService.backupArticle()` instead of the inline per-article raw batch.
- **`FirestoreSyncManagerTest.kt`**: Updated the tag-backup N+1 characterization test: old
  assertion `verify(exactly = 2) { firestore.batch() }` → new assertion
  `coVerify(exactly = 2) { firestoreBackupService.backupArticle(...) }`. Removed now-unused
  imports (`CollectionReference`, `DocumentReference`, `WriteBatch`, `Tasks`, `verify`).

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt` —
  extracted `addArticleToBatch` and `withAuthenticatedUser`; applied `withAuthenticatedUser` to 13
  method sites; replaced two inline large-text blocks with `addArticleToBatch` calls
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` —
  deleted 2 dead constants, removed unused `await` import, delegated tag-backup to `backupArticle`
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt` —
  updated characterization test + removed 5 unused imports

## Shared Files (also touched by sibling slices)

- `FirestoreBackupService.kt` — also touched by `test-net`, `streaming-restore`, `batched-tag-reads`.
  This slice's changes are additive (new private helpers) and do not conflict.
- `FirestoreSyncManager.kt` — also touched by `app-scope` (scope injection), `batched-tag-reads`
  (`applyRemoteArticles` + `handleRemoteArticleChange` signature). This slice deletes constants and
  re-wires the tag-backup path; `applyRemoteArticles` was found already present from
  `batched-tag-reads` — no conflict.

## Notes on Design Choices

- **`withAuthenticatedUser` is not `inline`**: The plan proposed `private suspend inline fun`.
  Kotlin's `inline` modifier on a `suspend` function with a `suspend` lambda block is permitted but
  the practical benefit (avoiding the suspend-lambda object allocation) is negligible in a
  Firestore I/O path. Using a plain `private suspend fun` keeps the code simpler with identical
  semantics and avoids a potential compiler warning about inline + non-`crossinline` suspend lambdas
  in some Kotlin versions.
- **`batchRestoreArticleTags` guard not unified**: Its return type is `Map<String, List<ArticleTags>>`,
  not `Result<T>`, so `withAuthenticatedUser` does not fit. The existing early-return `?: return emptyMap()`
  is kept as-is. This was called out as an intentionally-distinct path in the plan.
- **`firestore` constructor parameter kept**: After the inline tag-batch removal, `FirestoreSyncManager`
  no longer calls `firestore.collection(...)` or `firestore.batch()` in its body; the injected
  `firestore: FirebaseFirestore` field is technically dead. Removing a constructor parameter changes
  the Hilt DI graph and would require updating the test harness; the plan did not ask for it.
  Marked as a deferral below.

## Verification Seams Built

None needed — all ACs are structure-only (no user-observable behaviour surface). The characterization
suite from `test-net` is the verification instrument: it runs against the post-refactor code and
must stay green. Full suite green: `BUILD SUCCESSFUL` after all steps.

## Deviations from Plan

1. **Step 5 (`applyRemoteArticles`) already present (done by `batched-tag-reads`)**: When this
   slice landed, `applyRemoteArticles` was already implemented in `FirestoreSyncManager` by the
   `batched-tag-reads` slice — including the fuller batch-prefetch form. Both `onPage` lambda sites
   were already delegating to it. No action taken; Step 5 recorded as pre-done.
2. **`withAuthenticatedUser` is not `inline`**: Plan proposed `inline`; actual uses plain `suspend fun`
   (see Notes on Design Choices above).

## Anything Deferred

- **Dead `firestore` field in `FirestoreSyncManager`**: After the inline tag-batch removal,
  `private val firestore: FirebaseFirestore` in `FirestoreSyncManager` is injected but never called.
  Removing it is a follow-on cleanup; it requires a Hilt DI update and test-constructor change.
  `firestore-io` (B2) may reintroduce a direct firestore reference, at which point this becomes
  moot. Deferred to a future simplify pass.

## Known Risks / Caveats

- The tag-backup delegation to `backupArticle` adds Firestore write bytes per article (article doc
  re-written idempotently) in the `syncLocalChanges` tag path. This is intentional and documented
  in the test's inline comment. Behaviour is preserved; write-cost optimisation is `firestore-io`'s
  territory.

## Freshness Research

No external research required for this behaviour-preserving structural slice. Plan carried forward:
- `SetOptions.merge()` — idempotent partial update; re-writing an existing article doc is safe.
- Kotlin `inline suspend fun` — valid in Kotlin 2.x but chose plain `suspend fun` (see Notes).
- `WriteBatch` — 10 MiB/commit + 500-doc soft guideline; no batch limits changed by this slice.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app firestore-dedup` — run characterization
  suite to confirm B1 AC passes with the new structure
- **Option B:** `/wf review simplify-android-app firestore-dedup` — skip verify (purely structural
  slice, test suite already confirmed green locally)
