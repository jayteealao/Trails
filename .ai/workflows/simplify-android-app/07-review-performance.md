---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: performance
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 2
metric-findings-blocker: 0
metric-findings-high: 1
metric-findings-resolved: 0
result: issues-found
tags: []
refs:
  review-master: 07-review.md
---

# Review: performance

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| PE-1 | HIGH | High | open | 2026-07-06 | `FirestoreSyncManager.kt:296-305` | Tag prefetch N+1 serial DAO reads in syncLocalChanges (cross-ref CR-1) |
| PE-2 | NIT | Low | open | 2026-07-06 | `ArticleListItem.kt:83-90` | parsedSnippet initial HtmlCompat.fromHtml allocation on main thread |

## Detailed Findings

### PE-1: N+1 DAO Reads in syncLocalChanges Chunk Loop [HIGH]

See CR-1 in correctness dimension. Same finding cross-referenced. Fix: `getTagsForArticles(itemIds)` bulk DAO query.

---

### PE-2: parsedSnippet Initial Allocation on Compose Main Thread [NIT]

**Location:** `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleListItem.kt:83-90`

**Evidence:**
```kotlin
val parsedSnippet: AnnotatedString? = remember(article.snippet) {
    if (!article.snippet.isNullOrBlank())
        HtmlCompat.fromHtml(article.snippet, HtmlCompat.FROM_HTML_MODE_LEGACY)
            .toAnnotatedString()
    else null
}
```

**Issue:** `HtmlCompat.fromHtml()` is a blocking call that runs synchronously on the first composition. For very long HTML snippets this may add a few milliseconds to the first frame. The `remember(article.snippet)` key ensures it only runs once per unique snippet, so there is no repeat allocation — this is correct. For typical excerpt-length snippets (< 500 chars) this is imperceptible. NIT-level concern only.

**Severity:** NIT | **Confidence:** Low
**Status:** open | **Surfaced:** 2026-07-06

---

## Summary
- HIGH: 1 (PE-1 = cross-ref CR-1 — fix required)
- NIT: 1 (defer)

## Positive performance improvements
- Streaming paginated restore eliminates OOM for large datasets
- Tags folded into same Firestore batch (N+1 Firestore writes → 1 per chunk)
- Palette computation eliminated — major recomposition reduction; no more animateFloat/infiniteTransition overhead
- `remember(article.snippet)` for HTML parse — no redundant allocation on scroll recomposition
- `remember(article.tagsString, tags)` for tagStates — replaces two LaunchedEffects; no coroutine overhead
- `@Deprecated` on `getAllArticles()` — prevents accidental OOM-inducing call
