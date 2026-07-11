---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: testing
status: complete
updated-at: "2026-07-10T23:46:54Z"
metric-findings-total: 2
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 1
metric-findings-resolved: 1
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: testing

## Findings

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| TE-1 | LOW | High | resolved | true | 2026-07-06 | `FirestoreSyncManagerTest.kt` | Missing bulk-DAO test for getTagsForArticles — resolved: method and test landed in 8362d4c + 56a6533 |
| TE-2 | NIT | Med | open | true | 2026-07-06 | `ArticleDao.kt:291-302` | deleteAllTagsForArticle atomicity window documented but untested |
| TE-3 | NIT | High | open | false | 2026-07-11 | `FirestoreSyncManager.kt:567-583` | updateBackedUpAt try-catch exception path in reconcile sweep untested |

## Detailed Findings

### TE-1: Bulk DAO Tag Fetch Test [LOW] — RESOLVED

**Location:** `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt`

**Issue:** The fix for CR-1 (`getTagsForArticles(itemIds)` bulk DAO method) was anticipated to require a new test asserting exactly one DAO call per chunk. This gap is now closed: the method was added in commit `8362d4c` and the test pinning one bulk call per chunk (with `coVerify(exactly = 1) { articleDao.getTagsForArticles(...) }` and `coVerify(exactly = 0) { articleDao.getArticleTags(any()) }`) was landed in `56a6533`.

**Severity:** LOW | **Confidence:** High | **Pre-existing:** true
**Status:** resolved | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-06 | **Resolved:** 2026-07-10

---

### TE-2: deleteAllTagsForArticle Atomicity Window Untested [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt:291-302`

**Issue:** The KDoc on `deleteAllTagsForArticle` documents a transient window where an article has no tags between delete and insert (not wrapped in `@Transaction`). This is accepted as safe for the background-only sync path, but no test verifies the documented constraint or the "delete then insert" ordering. Low risk in practice. No change in the unreviewed delta touches this code.

**Fix:** Add a unit test asserting that `deleteAllTagsForArticle` is only called from the sync path (never from UI), or annotate the non-atomicity as an explicit accepted invariant with a `@VisibleForTesting` note.

**Severity:** NIT | **Confidence:** Med | **Pre-existing:** true
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-10

---

### TE-3: updateBackedUpAt Exception Path in Reconcile Sweep Untested [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:567-583`

**Evidence:**
```kotlin
result.fold(
    onSuccess = { count ->
        val now = System.currentTimeMillis()
        chunk.forEach { article ->
            try {
                articleDao.updateBackedUpAt(article.itemId, now)
            } catch (e: Exception) {
                // ← this catch path is not directly tested
                Timber.w(e, "reconcile: failed to stamp backed_up_at for ${article.itemId}")
            }
        }
        sweptCount += count
        ...
    },
)
```

**Issue:** The try-catch around `articleDao.updateBackedUpAt()` was added in commit `249eb41`. If `updateBackedUpAt` throws, the article remains `backed_up_at IS NULL`. On the next loop iteration, the stall guard detects the same chunk IDs and terminates the sweep — the failure is recoverable but silent. No test exercises the catch path explicitly. The indirect behavior (stall guard firing after a stamp-silent iteration) is covered by `reconcile terminates when the same rows keep returning`, but the direct throw→catch→log→continue path is not.

**Fix:** Add a test where `updateBackedUpAt` throws for one article: verify the sweep continues for remaining articles in that chunk, then verify the stall guard fires on the next iteration and the sweep terminates cleanly without crashing.

**Severity:** NIT | **Confidence:** High | **Pre-existing:** false
**Status:** open | **Surfaced:** 2026-07-10 | **Last seen:** 2026-07-10

---

## Summary

- Open findings: 2    (resolved this run: 1)
- Open blockers: 0    (pre-existing excluded; pre-existing findings: 1)
- Status: Issues Found (NIT only — ship not blocked)

## Overall Assessment

Test coverage for the unreviewed delta (commits `2ff0200`, `b8da752`, `fd2778e`, `249eb41`) is comprehensive. All 5 reconcile-stall-guard ACs have dedicated, named, passing tests. The write-count batch-chunking change is verified with per-batch mock separation (3 distinct `WriteBatch` mocks, each committed exactly once). Keyset pagination in `SyncWorker` is correctly updated in `SyncWorkerTest`. The transactional `upsertArticlesWithAssociatedData` delegation is pinned by `DefaultArticleRepositoryTest`.

Prior TE-1 (forward gap for `getTagsForArticles` bulk DAO method) is now RESOLVED — the method was landed in `8362d4c` and the one-call-per-chunk test in `56a6533`, both before the current review window.

Full suite: 153/153 tests green (per `06-verify-reconcile-stall-guard.md`).

**Positive observations:**
- All 5 ACs for `reconcile-stall-guard` have named passing tests mapped by AC number in the slice spec.
- Tests use `returnsMany` sequences (not fixed returns) to correctly simulate the offset-0 re-query contract, avoiding a common mock-ordering pitfall.
- AC4 has both a new-article stamping test and a local-wins non-stamping companion — good symmetry.
- The stall-guard test (`reconcile terminates when the same rows keep returning`) correctly models a genuine stall (same IDs returned) rather than relying on mock call count.
- The batch-chunking test (`backupArticlesPaginated flushes when next article would exceed write-count threshold`) uses separate `batch1`/`batch2`/`batch3` mocks, making the three-commit assertion unambiguous.
