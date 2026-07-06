---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: refactor-safety
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 0
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: clean
fragment: none
tags: []
refs:
  review-master: 07-review.md
---

# Review: refactor-safety

## Summary

All refactors are safe and non-breaking.

- **ArticleRepository interface additions**: `backupArticleNow`, `saveNewArticle`, `upsertArticle`, `updateUnfurledDetails` are additive — no existing callers broken.
- **GetArticleWithTextUseCase deletion**: The class is deleted. All callers were in `ArticleListViewModel` which was updated to call `ArticleRepository` directly. No orphaned references remain.
- **@ApplicationScope injection**: Replaces bare `CoroutineScope(SupervisorJob() + Dispatchers.IO)` construction in `FirestoreSyncManager` and `CoroutineScope(ioDispatcher)` in `ArticleRepositoryImpl`. The injected scope has the same lifecycle (app-lifetime, supervised) — semantic equivalence preserved.
- **UrlModifier @Singleton promotion**: `UrlModifier` is stateless; promoting to `@Singleton` is safe. All injection sites receive the same instance.
- **FTS query fix**: `searchWithScore` now passes `sanitizedQuery` — a pure bug fix, no refactor risk.
- **`@Deprecated` on `getAllArticles()`**: Deprecation annotation added, implementation not removed — backward-compatible.
- **`cleanup()` in FirestoreSyncManager**: Changed from `scope.cancel()` to a no-op comment. This is safe because `cancelPeriodicSync()` (the actual useful part) is retained; the shared `@ApplicationScope` must not be cancelled by a single consumer.

## Findings

None. Dimension is clean.
