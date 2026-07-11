---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: data-integrity
status: complete
updated-at: "2026-07-10T23:45:08Z"
metric-findings-total: 2
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 2
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: data-integrity

## Findings

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| DI-1 | NIT | Low | open | true | 2026-07-06 | `ArticleDao.kt:508` | Pre-existing TODO: timeAdded = existingArticle.timeAdded in upsertNewArticle (not introduced by this branch) |
| DI-2 | MED | High | deferred | true | 2026-07-10 | `ArticleDao.kt:502-530` | upsertNewArticle merge-copy drops backedUpAt — already tracked as follow-up by branch authors |

## Detailed Findings

### DI-1: upsertNewArticle timeAdded TODO [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt:508`

**Evidence:**
```kotlin
timeAdded = existingArticle.timeAdded, //TODO: this is not right
```

**Issue:** The merge-copy in `upsertNewArticle` pins `timeAdded` to the existing row's value with a TODO acknowledging this is incorrect. The API-provided `newArticle.timeAdded` is silently discarded on re-add. Not introduced by this branch.

**Fix:** Use `newArticle.timeAdded` (the API-authoritative value) rather than pinning to the existing row's timestamp.

**Severity:** NIT | **Confidence:** Low | **Pre-existing:** true
**Status:** open | **Surfaced:** 2026-07-06 | **Last seen:** 2026-07-10T23:45:08Z

---

### DI-2: upsertNewArticle merge-copy silently drops backedUpAt [MED]

**Location:** `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt:502-530`

**Evidence:**
```kotlin
upsertArticle(
    newArticle.copy(
        itemId = existingArticle.itemId,
        articleId = existingArticle.articleId,
        resolvedId = existingArticle.resolvedId,
        timeUpdated = newArticle.timeAdded,
        timeAdded = existingArticle.timeAdded, //TODO: this is not right
        title = newArticle.title.ifBlank { existingArticle.title },
        // ... many fields ...
        // backedUpAt NOT included — falls through as null from newArticle
    )
)
```

**Issue:** The merge-copy does not include `backedUpAt = existingArticle.backedUpAt`. When a user re-adds a URL already in their library (common share-intent flow), `upsertNewArticle` is called with a fresh `Article` object where `backedUpAt` is `null`. The merge-copy preserves many fields from `existingArticle` but silently omits `backedUpAt`, so the article's previous backup stamp is lost. On the next sync, the reconcile sweep (`WHERE backed_up_at IS NULL`) picks it up and performs an unnecessary Firestore re-upload.

This is a data-correctness issue (the `backedUpAt` invariant — "a row stamped once must stay stamped unless re-added from scratch" — is violated), but not data-loss: Firestore already has the article and the re-upload is idempotent. The practical cost is one extra billed Firestore write per re-add.

The `backedUpAt` column is new to this branch, and the `upsertNewArticle` merge-copy was not modified by any branch commit. The branch's stamp-monotonicity audit (`06-verify-reconcile-stall-guard.md`) identified this and deferred it as a follow-up task.

**Fix:** Add the following field to the `newArticle.copy(...)` block in `upsertNewArticle`:
```kotlin
backedUpAt = existingArticle.backedUpAt,
```

**Severity:** MED | **Confidence:** High | **Pre-existing:** true
**Status:** deferred | **Surfaced:** 2026-07-10T23:45:08Z | **Last seen:** 2026-07-10T23:45:08Z

---

## Summary

- Open findings: 2    (resolved this run: 0)
- Open blockers: 0    (pre-existing excluded; pre-existing findings: 2)
- Status: Issues Found (all pre-existing; no new regressions from unreviewed delta)

### Unreviewed Delta Assessment (commits 2ff0200, b8da752, fd2778e, 249eb41)

**2ff0200 — transaction-wrapped ArticleRepository.add():** The new `upsertArticlesWithAssociatedData(@Transaction)` DAO method correctly atomizes the previously-split multi-step write (articles + images/videos/tags/authors/domain metadata). The articles and dataList parameters carry their own itemId references, so there is no positional-mismatch risk. The atomicity guarantee is correct.

**b8da752 — backup batch chunking by write count:** The `articleWrites` estimate (`1 + largeTextWrites + tags.size + markerKeysFor(article).size`) precisely matches the actual writes performed by `addArticleToBatch` + `addMarkerWrites`. The flush-before-add guard correctly prevents batches from exceeding WRITE_COUNT_THRESHOLD (500) while preserving the all-or-nothing per-article guarantee.

**fd2778e — cursor-based pagination for non-metrics load:** `getNonMetricsArticles(limit, afterId)` using `itemId > :afterId ORDER BY itemId ASC` eliminates the skip/duplicate risk from the prior OFFSET approach when concurrent modifications change row positions between pages. The initial `afterId = ""` correctly returns all rows (all non-empty itemIds are lexicographically greater than an empty string).

**249eb41 — reconcile stall guard:** The row-identity stall guard (`chunkIds == prevChunkIds`), iteration cap (1000), and backedUpAt stamping on remote-won upserts are all logically sound. The zero-changes sweep gating (calling reconcile even when `totalCount == 0`) correctly catches offline-stranded articles invisible to the incremental path. Local-wins rows intentionally remain unstamped. The `upsertArticle` call (not `upsertNewArticle`) is used for remote-won upserts, so the DI-2 drop does not affect this path.
