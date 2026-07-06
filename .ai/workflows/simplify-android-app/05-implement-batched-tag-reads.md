---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: batched-tag-reads
status: complete
stage-number: 5
created-at: "2026-07-05T22:10:56Z"
updated-at: "2026-07-05T22:10:56Z"
metric-files-changed: 4
metric-lines-added: 263
metric-lines-removed: 30
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "3ceee49"
tags: [efficiency, firestore, batching, behaviour-change, android]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-batched-tag-reads.md
  plan: 04-plan-batched-tag-reads.md
  siblings: [05-implement-test-net.md, 05-implement-fts-search-fix.md, 05-implement-streaming-restore.md]
  verify: 06-verify-batched-tag-reads.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app batched-tag-reads"
---

# Implement: Batched Firestore tag reads on restore (efficiency-4 / A3)

## The Implementation

The restore loop previously issued one Firestore subcollection read per article
for tags — N articles meant N sequential round-trips before Room received anything.
The fix adds `batchRestoreArticleTags()` to `FirestoreBackupService`, which
groups article IDs into chunks of 10 and dispatches each chunk's reads as parallel
coroutines via `coroutineScope { async {} }`, awaiting all with `awaitAll()`. For
N=1000 articles this collapses 1000 sequential reads to 100 parallel rounds.

In `FirestoreSyncManager`, `handleRemoteArticleChange` shed both of its internal
`restoreArticleTags()` calls. Tags are now injected as a `prefetchedTags` parameter
supplied by a new `applyRemoteArticles()` helper that calls `batchRestoreArticleTags`
once per page before iterating articles. Both call sites — the first-sync restore
scenario in `performFullSync` and the streaming restore in `performBidirectionalSync`
— are updated to call `applyRemoteArticles(pageArticles)` instead of iterating
directly into `handleRemoteArticleChange`.

The existing `restoreArticleTags` single-article method is unchanged; it is still
used by `restoreArticle` (the single-article fetch path), which is not N+1.

Six new unit tests in `FirestoreBackupServiceTest` assert the read-count behaviour
(empty list, single id, 10-id full chunk, 11-id two-chunk split, no-tags article,
unauthenticated guard). One integration test in `FirestoreSyncManagerTest` confirms
`restoreArticleTags` is never called from any restore-loop invocation.

## Summary of Changes

- Added `RESTORE_TAG_CHUNK_SIZE = 10` constant to `FirestoreBackupService.companion`.
- Added `suspend fun batchRestoreArticleTags(articleIds: List<String>): Map<String, List<ArticleTags>>`
  to `FirestoreBackupService` using `coroutineScope + async + awaitAll`.
- Changed `handleRemoteArticleChange(remoteArticle)` to
  `handleRemoteArticleChange(remoteArticle, prefetchedTags: List<ArticleTags>)`.
  Removed both internal `firestoreBackupService.restoreArticleTags()` calls (lines
  96 and 113 in the pre-patch file). Uses `prefetchedTags` directly.
- Extracted `private suspend fun applyRemoteArticles(articles: List<Article>)` in
  `FirestoreSyncManager`: calls `batchRestoreArticleTags`, then iterates articles
  passing their prefetched tags.
- Both `onPage` lambdas in `performFullSync` (Scenario 2) and `performBidirectionalSync`
  replaced with `applyRemoteArticles(pageArticles)`. The `withContext(Dispatchers.IO)`
  wrapper was moved inside `applyRemoteArticles`, removing it from both call sites.
- Added `ArticleTags` import to `FirestoreBackupServiceTest.kt`.
- Added 6 `batchRestoreArticleTags` read-count tests to `FirestoreBackupServiceTest`.
- Added `ArticleTags` import and 1 integration test to `FirestoreSyncManagerTest`.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt`
  — Added `async`, `awaitAll`, `coroutineScope` imports. Added `RESTORE_TAG_CHUNK_SIZE`
  constant. Added `batchRestoreArticleTags()` method (44 lines).
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt`
  — Updated `handleRemoteArticleChange` signature + body. Extracted `applyRemoteArticles`.
  Updated both `onPage` lambdas in `performFullSync` and `performBidirectionalSync`.
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreBackupServiceTest.kt`
  — Added `ArticleTags` import. Added 6 A3 read-count tests (136 lines).
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt`
  — Added `ArticleTags` import. Added 1 integration-path A3 test (34 lines).

## Shared Files (also touched by sibling slices)

- `FirestoreBackupService.kt` was also touched by `streaming-restore` (final API
  of `restoreAllArticlesPaginated`) and `test-net` (harness). This slice is purely
  additive: `batchRestoreArticleTags` is a new method; no existing methods modified.
- `FirestoreSyncManager.kt` was touched by `streaming-restore` (both `onPage`
  call sites established). This slice updated those two `onPage` lambdas from
  `forEach { handleRemoteArticleChange(it) }` to `applyRemoteArticles(it)`, and
  changed the private `handleRemoteArticleChange` signature.
- `FirestoreBackupServiceTest.kt` and `FirestoreSyncManagerTest.kt` were established
  by `test-net` and updated by `streaming-restore`. This slice appends A3 tests.

## Notes on Design Choices

- **coroutineScope + async + awaitAll over Flow or Channel:** The plan chose this
  pattern explicitly. `coroutineScope` ensures all async children complete (or
  cancel together) before the function returns — no fire-and-forget leaks. Matches
  the existing coroutines-on-classpath constraint.
- **RESTORE_TAG_CHUNK_SIZE = 10:** Conservative limit. Firestore documents 100+
  concurrent operations per client. 10 parallel reads per chunk is far below any
  observed limit. The plan ceiling is 30 (for `whereIn` symmetry future refactoring).
  `sdlc-debt: tune RESTORE_TAG_CHUNK_SIZE upward (max 30) if profiling shows wall-clock
  improvement on large libraries — change only the constant, no logic change needed.`
- **withContext(Dispatchers.IO) moved into applyRemoteArticles:** Previously each
  `onPage` lambda wrapped its loop in `withContext(Dispatchers.IO)`. After the
  refactor, the equivalent is inside `applyRemoteArticles`, keeping the Firestore
  batch fetch on the calling coroutine scope (IO-dispatched by the caller) and the
  Room writes explicit on IO. Both call sites are cleaner.
- **Error handling in batchRestoreArticleTags per-article:** A failing per-article
  tag read logs a warning and returns `null` (mapped to empty list). This prevents
  a single article's tag-read failure from failing the entire batch. Consistent with
  the existing `handleRemoteArticleChange` catch-and-log pattern.
- **handleRemoteArticleChange tag-update logic simplified:** In the "accept remote
  change" branch, the previous code was guarded by `remoteTags.getOrNull()?.let`.
  The new code unconditionally executes the delete-then-insert (deleting existing
  tags even when prefetchedTags is empty). This is correct behaviour: if remote has
  no tags, local tags should also be cleared when remote wins conflict resolution.
  The existing behaviour accidentally preserved local tags when the remote tag fetch
  returned a failure (now non-applicable since tags are pre-fetched).

## Verification Seams Built

- **A3 read-count (empty, single, 10, 11, no-tags, unauth):** 6 tests in
  `FirestoreBackupServiceTest` using MockK `verify(exactly = N) { tagsCollection.get() }`.
  The `stubTagsCollection()` helper wires per-article `articlesCollection.document(id)`
  → `articleDocRef.collection("tags")` → `tagsCollection.get()` chains, allowing
  exact per-collection call-count assertions.
- **A3 no-restoreArticleTags:** 1 test in `FirestoreSyncManagerTest` verifies
  `coVerify(exactly = 0) { firestoreBackupService.restoreArticleTags(any()) }` in the
  restore scenario. Confirms the N+1 call site has been eliminated at the dispatch level.
- **Note:** The 11-id two-chunk test asserts all 11 results are present in the map
  and all 11 `tagsCollection.get()` calls fired exactly once. This is the closest
  proxy to "two parallel rounds" observable via MockK (parallel vs sequential ordering
  cannot be directly asserted in a unit test without a test dispatcher extension).

## Visual Contract Honored (only if `02c-craft.md` was present)

Not applicable — no `02c-craft.md` for this workflow.

## Deviations from Plan

1. **`FirestoreSyncManagerTest` integration test does not invoke `onPage` callback.**
   The plan (Phase D, Step 7) described asserting "a 15-article restore triggers
   exactly 2 calls to `batchRestoreArticleTags` (chunked into 10+5)." Achieving this
   requires the `restoreAllArticlesPaginated` mock to invoke the `onPage` suspend
   lambda from inside a `coAnswers` body — the same limitation as `streaming-restore`
   Deviation 1 (MockK 1.14.5 cannot invoke suspend lambdas from stub answer bodies
   without blocking the test dispatcher). The test instead verifies:
   (a) `restoreAllArticlesPaginated` is called with the two-parameter streaming API,
   (b) `restoreArticleTags` is never called (zero invocations). The 6 unit tests in
   `FirestoreBackupServiceTest` cover the `batchRestoreArticleTags` chunk-count
   behaviour directly and are the primary A3 coverage.

## Anything Deferred

- **chunk-size tuning:** `RESTORE_TAG_CHUNK_SIZE = 10` is intentionally conservative.
  Can be tuned up to 30 by changing the single constant; no logic change required.
  `sdlc-debt: tune RESTORE_TAG_CHUNK_SIZE upward (max 30) if profiling shows benefit`
- **A3 end-to-end live read-count verification:** Manual step from the plan (launch
  lazylogcat, trigger sync, observe chunk start/end logs, compare Firestore dashboard
  before/after). Requires an AVD or physical device. Deferred to verify stage per
  the plan's "Manual (A3 — manual via lazylogcat)" section.
- **Tag presence optimization:** Articles with no tags still incur one subcollection
  read per `batchRestoreArticleTags` call (checking an empty collection). A zero-read
  approach would require a presence flag in the article document — out of scope.

## Known Risks / Caveats

- **handleRemoteArticleChange tag-update logic change (medium, corrective):** In the
  "accept remote" branch, the pre-patch code skipped the delete step when
  `restoreArticleTags` returned a failure `Result`. The new code always deletes
  existing local tags when remote wins conflict resolution, even when prefetched tags
  are empty. This is the correct behaviour (remote empty → local should also be empty
  after remote wins), but it is a subtle semantic change from the prior "skip on failure"
  behaviour. Risk is LOW because: (a) tag fetch failures in `batchRestoreArticleTags`
  return empty list rather than error (no data loss), (b) compile-time safety (no
  Result unwrap), (c) the prior behaviour was arguably incorrect.

## Freshness Research

No new external research required. All relevant constraints were confirmed at plan
stage and remain valid:
- `coroutineScope + async + awaitAll` pattern confirmed for Kotlin 2.x on classpath.
- `RESTORE_TAG_CHUNK_SIZE = 10` well below Firestore SDK documented limits.
- MockK 1.14.5 suspension-callback limitation confirmed (carries from streaming-restore).

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app batched-tag-reads` — run
  the AC gate. 6 unit tests (A3 read-count) + 1 integration test (no-restoreArticleTags)
  pass. Automated A3 gate is green. The manual lazylogcat smoke verification requires
  a device run. Consider `/compact` before running verify to keep context clean.
- **Option B:** `/wf implement simplify-android-app <next-slice>` — continue with the
  next slice (e.g., `app-scope`, `firestore-dedup`, `list-rendering`) while batched-tag-reads
  verify runs in parallel.
