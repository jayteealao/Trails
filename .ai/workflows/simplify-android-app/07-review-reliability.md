---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: reliability
status: complete
updated-at: "2026-07-10T23:54:22Z"
metric-findings-total: 1
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 1
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: reliability

## Findings

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| RE-1 | MED | Med | fixed | false | 2026-07-06 | `FirestoreSyncManager.kt:491-494` | CancellationException not re-thrown in performFullSync |
| RE-2 | LOW | Med | open | true | 2026-07-06 | `FirestoreSyncManager.kt:579-583` | reconcileNeverBackedUpArticles stops on first chunk failure |
| RE-3 | HIGH | High | fixed | false | 2026-07-11 | `FirestoreBackupService.kt:741-770` | WRITE_COUNT_THRESHOLD removes article-count cap, breaking Firestore rules doc-access budget — fixed `8b06e84` |

## Detailed Findings

### RE-1: CancellationException Not Re-thrown in performFullSync [MED]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:491-494`

**Evidence:**
```kotlin
} catch (e: Exception) {
    // Re-throw CancellationException so structured concurrency propagates correctly
    // (review fix RE-1).
    if (e is CancellationException) throw e
    Timber.e(e, "Full sync failed: ${e.message}")
    _lastError.value = e.message ?: "Full sync failed"
    _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
}
```

**Issue:** Was: catch block did not re-throw CancellationException, risking suppression of coroutine cancellation. Fixed by 2026-07-06T02:04:08Z.

**Fix:** Applied — `if (e is CancellationException) throw e` added as first statement in catch.

**Severity:** MED | **Confidence:** Med | **Pre-existing:** false
**Status:** fixed | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-06 | **Fixed:** 2026-07-06T02:04:08Z

---

### RE-2: reconcileNeverBackedUpArticles Stops on First Chunk Failure [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:579-583`

**Evidence:**
```kotlin
onFailure = { e ->
    Timber.w(e, "reconcile: backup failed for chunk, stopping sweep")
    return
}
```

**Issue:** A transient network error for one chunk silently stops the reconcile sweep. Subsequent never-backed-up articles are not processed until the next periodic sync cycle. The code was substantially rewritten by commit 249eb41 (the stall-guard slice), but the early-return-on-failure behavior is preserved verbatim at new line numbers (previously 538-542, now 579-583). Finding re-anchored; functional status unchanged.

**Fix:** Log the failure and continue to the next chunk rather than returning. Increment a `failureChunks` counter; log the total at sweep end. Consider emitting a metric so a run with persistent chunk failures is surfaced to monitoring.

**Severity:** LOW | **Confidence:** Med | **Pre-existing:** true
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-10

---

### RE-3: backupArticlesPaginated WRITE_COUNT_THRESHOLD Removes Article-Count Cap, Breaking Firestore Rules Document-Access Budget [HIGH]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt:741-770`

**Evidence — new loop (b8da752):**
```kotlin
articles.forEach { article ->
    val tags = tagsByArticleId[article.itemId] ?: emptyList()
    val textSize = article.text?.toByteArray()?.size ?: 0
    val largeTextWrites = if (textSize > MAX_TEXT_SIZE && article.text != null) 1 else 0
    val articleWrites = 1 + largeTextWrites + tags.size + markerKeysFor(article).size

    // Flush before threshold, never split a single article.
    if (batchWriteCount > 0 && batchWriteCount + articleWrites > WRITE_COUNT_THRESHOLD) {
        batch.commit().await()
        ...
    }
    addArticleToBatch(batch, articleRef, article, tags)
    addMarkerWrites(batch, user.uid, article)
    batchWriteCount += articleWrites
}
```

**Evidence — Firestore rules (firestore.rules:64-67):**
```
// RULES BUDGET: getAfter costs 1 call (cached per path within the request);
// get() on the fallback costs 1 additional call only when getAfter fails.
// Total ≤ 2 per article in a batch. Callers must keep batches ≤ 20 articles
// to stay within the 20-document-access limit per batched write.
```

**Evidence — the rule that fires getAfter per marker write (firestore.rules:74):**
```
getAfter(/databases/$(database)/documents/users/$(userId)/articles/$(request.resource.data.itemId)).data != null
```

**Issue:** Commit b8da752 replaced the article-count-based chunking (`WRITE_BATCH_LIMIT = 20` → `articles.chunked(20)`) with write-count-based chunking (`WRITE_COUNT_THRESHOLD = 500`). Before the change, a 50-article call from `syncLocalChanges` produced 3 batches of ≤ 20 articles. After the change, those same 50 plain articles (≈ 100 writes, well under 500) land in a single WriteBatch — causing 50 `getAfter()` calls during rules evaluation.

The Firestore security rules call `getAfter()` once per unique article path per batch commit request. Although an article may produce 1–2 markers, both share the same `article.itemId` in their `request.resource.data.itemId`, so paths are cached: exactly 1 `getAfter` call per article. The hard limit is 20 document-access calls per request. With `chunkSize = 50` (regular sync) the batch has 50 `getAfter` calls; with `chunkSize = 200` (first sync) up to 200. Both exceed the limit, and Firestore rejects the commit with a quota/permission error.

**Call sites that are affected:**
- `syncLocalChanges` (FirestoreSyncManager.kt:320) passes chunks of 50/200 articles.

**Call site that is NOT affected:**
- `reconcileNeverBackedUpArticles` (FirestoreSyncManager.kt:565) passes ≤ `RECONCILE_CHUNK_SIZE = 20` articles — already within budget.

**Failure scenario:**
1. User has >20 articles. Regular sync runs.
2. `syncLocalChanges` fetches 50 articles, calls `backupArticlesPaginated(articles=50)`.
3. Inside, all 50 articles fit in one WriteBatch (100 writes < 500 threshold).
4. `batch.commit().await()` triggers rules evaluation: 50 unique `getAfter` calls.
5. Firestore rejects: "Quota exceeded: too many document accesses".
6. Outer try/catch returns `Result.failure`. `syncLocalChanges` increments `failureCount`, continues.
7. No articles are backed up for that chunk. (The reconcile sweep picks up `backedUpAt IS NULL` articles on the next run, but the stamp is also never set for newly-synced articles.)

**Fix:**
```kotlin
// Add alongside batchWriteCount:
var batchArticleCount = 0

// In the flush condition, check EITHER limit:
if (batchWriteCount > 0 && (batchWriteCount + articleWrites > WRITE_COUNT_THRESHOLD || batchArticleCount >= WRITE_BATCH_LIMIT)) {
    batch.commit().await()
    ...
    batchWriteCount = 0
    batchArticleCount = 0
}
// After adding article:
batchArticleCount++
```

This restores the original 20-article-per-batch ceiling for the getAfter budget while retaining the 500-write ceiling for large-tag articles.

**Severity:** HIGH | **Confidence:** High | **Pre-existing:** false
**Status:** fixed | **Surfaced:** 2026-07-11 | **Last seen:** 2026-07-11 | **Fixed:** 2026-07-10T23:54:22Z (commit `8b06e84`)

**Fix applied (review fix loop):** `batchArticleCount` counter added alongside `batchWriteCount`; the flush condition now fires when EITHER the write count would exceed `WRITE_COUNT_THRESHOLD` OR the batch already holds `WRITE_BATCH_LIMIT` (20) articles. Regression test added: 25 plain articles (50 writes, far under the write threshold) commit as 2 batches (20 + 5). The pre-existing chunking test was corrected to expect 3 commits for 45 articles. Full suite 154/154 green.

---

## Summary

- Open findings: 1 (resolved this run: 0; fixed this run: 1)
- Open blockers: 0 (pre-existing open findings: 1)
- Status: Issues Found — RE-3 (HIGH) fixed in review fix loop (`8b06e84`); only RE-2 (pre-existing LOW, deferred) remains open

## Positive reliability improvements in the reviewed delta

- `ArticleRepository.add()` wrapped in a single `@Transaction` DAO call (`upsertArticlesWithAssociatedData`) — articles and associated data are now atomic; no partial-insert orphan risk.
- `reconcileNeverBackedUpArticles` stall guard: row-identity comparison prevents the sweep from spinning when `updateBackedUpAt` fails silently. Two consecutive identical chunk IDs → clean break.
- Iteration cap (`MAX_RECONCILE_ITERATIONS = 1000`) as independent failsafe.
- Zero-changes sweep gating: reconcile runs even when the incremental article count is 0, catching offline-saved articles that are invisible to the `timeUpdated >= lastSync` predicate.
- `backedUpAt` stamp on remote-won upserts prevents re-upload of freshly pulled articles on the next reconcile cycle.
- Cursor-based pagination in `SyncWorker` (`itemId > :afterId`) eliminates the OFFSET drift problem under concurrent set mutation; correct for completeness (all items visited exactly once regardless of inserts).
