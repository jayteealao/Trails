---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: data-integrity
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 1
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: issues-found
fragment: none
tags: []
refs:
  review-master: 07-review.md
---

# Review: data-integrity

## Findings

| ID | Sev | Conf | Status | Surfaced | File:Line | Issue |
|----|-----|------|--------|----------|-----------|-------|
| DI-1 | NIT | Low | open | 2026-07-06 | `ArticleDao.kt:459` | Pre-existing TODO: timeAdded = existingArticle.timeAdded in upsertNewArticle (not introduced by this branch) |

## Summary

Data integrity is sound for all changes introduced by this branch:

- **FTS sanitization bug** fixed: `searchWithScore` now passes `sanitizedQuery` to DAO — corrupted search results from special characters eliminated.
- **upsertNewArticle**: field merge logic is correct for all modified fields. NIT: pre-existing `timeAdded` TODO noted but not introduced here.
- **deleteAllTagsForArticle**: atomic window documented; acceptable for background-only sync path.
- **backedUpAt**: properly `nullable Long`, stamped on successful Firestore write, `NULL` for never-backed-up articles — drives `reconcileNeverBackedUpArticles` correctly.
- **Soft-delete pattern**: `deleted_at`/`archived_at` maintained throughout; no hard deletes introduced.
- **Firestore batch size**: `RECONCILE_CHUNK_SIZE = 20` respects rules budget; articles not omitted from batches.
- **Tag conflict resolution**: `deleteAllTagsForArticle` + `insertArticleTags` is correct delete-then-insert pattern; no orphaned tags possible from this path.
