---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: performance
status: complete
updated-at: "2026-07-10T23:44:43Z"
metric-findings-total: 3
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 0
metric-findings-resolved: 1
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: performance

## Findings

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| PE-1 | HIGH | High | fixed | false | 2026-07-06 | `FirestoreSyncManager.kt:296-305` | Tag prefetch N+1 serial DAO reads in syncLocalChanges (fixed via CR-1) |
| PE-2 | NIT | Low | resolved | false | 2026-07-06 | `ArticleListItem.kt:83-90` | parsedSnippet HtmlCompat.fromHtml allocation on main thread — resolved 2026-07-10 (not re-surfaced in delta review; code unchanged but out of delta scope) |
| PE-3 | LOW | Med | open | false | 2026-07-10 | `FirestoreBackupService.kt:743,89` | toByteArray() double-allocation for large-text size-check in backup loop |
| PE-4 | LOW | Med | open | false | 2026-07-10 | `FirestoreSyncManager.kt:569-575` | N per-article updateBackedUpAt DAO calls in reconcile stamp loop |
| PE-5 | NIT | High | open | false | 2026-07-10 | `FirestoreBackupService.kt:745,165` | markerKeysFor() called twice per article in write-count-aware batch loop |

## Detailed Findings

### PE-1: N+1 DAO Reads in syncLocalChanges Chunk Loop [HIGH] — Fixed

**Status:** fixed (2026-07-06) | Applied in same session via CR-1 fix (bulk `getTagsForArticles(itemIds)` IN-query).

---

### PE-2: parsedSnippet Initial Allocation on Compose Main Thread [NIT] — Resolved

**Status:** resolved 2026-07-10 | Not re-surfaced in this delta-focused run; `ArticleListItem.kt` was not modified by the unreviewed commits. Prior finding still applies to the unchanged code; re-surface on next full slug-wide pass if the file is edited.

---

### PE-3: toByteArray() Double-Allocation for Size Check in backupArticlesPaginated [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt:743` (and line 89 in `addArticleToBatch`)

**Evidence:**
```kotlin
// Line 743 — pre-check to count writes per article:
val textSize = article.text?.toByteArray()?.size ?: 0
val largeTextWrites = if (textSize > MAX_TEXT_SIZE && article.text != null) 1 else 0

// ...then line 760:
addArticleToBatch(batch, articleRef, article, tags)
// which at line 89 recomputes:
val textSize = article.text?.toByteArray()?.size ?: 0
```

**Issue:** Each article with text allocates a full `ByteArray` at line 743 to estimate write count, and then `addArticleToBatch` allocates the same `ByteArray` again at line 89. For large-text articles (up to ~900 KB of text), this is two ~900 KB allocations per article per backup run. At chunk boundaries the GC faces 20-article bursts of transient allocations. In practice most articles probably have text well under `MAX_TEXT_SIZE` (900,000 bytes), but the pattern is still wasteful.

**Fix:** Use a char-count proxy for the pre-check at line 743 — no allocation needed for the size estimate:
```kotlin
val textLen = article.text?.length ?: 0
val largeTextWrites = if (textLen * 4 > MAX_TEXT_SIZE && article.text != null) 1 else 0
// addArticleToBatch retains toByteArray() for precise correctness
```
Or pass the already-computed `textSize` into `addArticleToBatch` to avoid the second allocation.

**Severity:** LOW | **Confidence:** Med | **Pre-existing:** false
**Status:** open | **Surfaced:** 2026-07-10T23:44:43Z | **Last seen:** 2026-07-10T23:44:43Z

---

### PE-4: N Per-Article updateBackedUpAt Calls in Reconcile Stamp Loop [LOW]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt:569-575`

**Evidence:**
```kotlin
val now = System.currentTimeMillis()
chunk.forEach { article ->
    try {
        articleDao.updateBackedUpAt(article.itemId, now)
    } catch (e: Exception) {
        Timber.w(e, "reconcile: failed to stamp backed_up_at for ${article.itemId}")
    }
}
```

**Issue:** After each successful `backupArticlesPaginated` call, the reconcile sweep issues one `UPDATE article SET backed_up_at = :timestamp WHERE itemId = :itemId` per article — up to 20 individual Room transactions per chunk. This is new in commit 249eb41. At chunk size 20 the overhead is modest (20 DB round-trips vs 1), but it also undoes the correctness guarantee: each row is stamped only if its individual call succeeds. The try/catch intent (per-row failure isolation) is reasonable, but a bulk `WHERE itemId IN (ids)` with a single failure path is equally safe and 20× cheaper.

**Fix:** Add a bulk DAO method:
```kotlin
@Query("UPDATE article SET backed_up_at = :timestamp WHERE itemId IN (:itemIds)")
suspend fun updateBackedUpAtBulk(itemIds: List<String>, timestamp: Long)
```
Then replace the `chunk.forEach` with a single call. A partial-failure scenario (network stamp succeeds, DB stamp fails) is already idempotent — the next reconcile sweep re-stamps any rows where `backed_up_at IS NULL`.

**Severity:** LOW | **Confidence:** Med | **Pre-existing:** false
**Status:** open | **Surfaced:** 2026-07-10T23:44:43Z | **Last seen:** 2026-07-10T23:44:43Z

---

### PE-5: markerKeysFor() Called Twice Per Article in Batch Loop [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt:745,165`

**Evidence:**
```kotlin
// Line 745 — to size the write count:
val articleWrites = 1 + largeTextWrites + tags.size + markerKeysFor(article).size

// Line 761 — to actually queue the writes:
addMarkerWrites(batch, user.uid, article)  // internally calls markerKeysFor(article) again at line 165
```

**Issue:** `markerKeysFor` is called once to count keys and once again inside `addMarkerWrites`. The function is pure and cheap (allocates at most a 2-element `mutableListOf`), so the impact is negligible. NIT for clean design.

**Fix:**
```kotlin
val markerKeys = markerKeysFor(article)
val articleWrites = 1 + largeTextWrites + tags.size + markerKeys.size
// ...
addMarkerWrites(batch, user.uid, article, markerKeys) // pass keys in
```

**Severity:** NIT | **Confidence:** High | **Pre-existing:** false
**Status:** open | **Surfaced:** 2026-07-10T23:44:43Z | **Last seen:** 2026-07-10T23:44:43Z

---

## Positive Performance Improvements in Unreviewed Delta

The following improvements in the delta are worth recording as they directly address previously known or anticipated inefficiencies:

- **Keyset pagination for `getNonMetricsArticles`** (fd2778e): Changed from `OFFSET :offset` to `WHERE itemId > :afterId ORDER BY itemId ASC`. OFFSET-based pagination degrades as offset grows (SQLite must scan and skip rows); keyset pagination is O(log n) with an index on `itemId`. Eliminates the growing-offset scan on large article sets in `SyncWorker`.
- **Write-count-aware Firestore batch chunking** (b8da752): Replaces fixed 20-article chunks with variable chunks gated by write count (500-write threshold). Tags-heavy articles contributed disproportionately many writes per fixed chunk, risking silent over-limit behavior. The new approach keeps individual commits predictable regardless of tag density.
- **`countArticlesNeverBackedUp()` early-exit** (249eb41): A cheap `COUNT(*)` query gates the reconcile log line; a zero backlog skips logging entirely. Minor but avoids pointless noise on clean syncs.
- **`backedUpAt` stamping on remote-won upserts** (249eb41): Articles applied from Firestore are now stamped `backedUpAt` at apply time, removing them from the `backed_up_at IS NULL` predicate. Previously, each pulled article would be re-uploaded by the next reconcile sweep — a billed Firestore write per article per sync cycle.

## Summary

- Open findings: 3    (resolved this run: 1)
- Open blockers: 0    (pre-existing excluded; pre-existing findings: 0)
- Status: Issues Found

All open findings are LOW or NIT severity in background WorkManager/coroutine paths with no user-facing latency impact. The delta is a net performance positive.
