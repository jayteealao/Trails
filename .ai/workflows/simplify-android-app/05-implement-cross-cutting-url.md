---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: cross-cutting-url
status: complete
stage-number: 5
created-at: "2026-07-06T01:20:23Z"
updated-at: "2026-07-06T01:20:23Z"
metric-files-changed: 5
metric-lines-added: 52
metric-lines-removed: 8
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "fb418ba"
tags: [behaviour-preserving, cross-cutting, reuse]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-cross-cutting-url.md
  plan: 04-plan-cross-cutting-url.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
    - 05-implement-article-repository.md
    - 05-implement-detail-viewmodel.md
    - 05-implement-list-viewmodel.md
    - 05-implement-list-rendering.md
    - 05-implement-sync-worker.md
  verify: 06-verify-cross-cutting-url.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app cross-cutting-url"
---

# Implement: Shared URL Normalization Extension (cross-cutting-url)

## The Implementation

Four scattered inline expressions — `normalizeUrl(article.url ?: article.givenUrl ?: "")` and its variants on Article receivers in three production files — collapse into a single delegating extension `Article.computeNormalizedUrl()`. The extension adds no logic: it calls `normalizeUrl` with the same null-coalescing fallback chain, producing byte-identical output at every replaced site. The 147-test suite (143 pre-existing + 4 new extension cases) passes with zero failures, which confirms the output is unchanged.

The one notable deviation from the plan: the extension could not live in `UrlNormalizer.kt`. The `data.local.database` package already imports `common.normalizeUrl` (AppDatabase.kt does so for a migration callback), so the reverse import would have formed a cycle. The extension instead lives in a new thin file `data/local/database/ArticleExt.kt` — same package as `Article`, zero extra imports at any call site. The plan explicitly documented this fallback.

The three string-typed call sites in `ArticleListViewModel.kt` (lines 306/364/430, where the URL is already a resolved/unfurled string, not an Article) and the two intentionally excluded sites in `SyncWorker.kt` and `AppDatabase.kt` are left exactly as they were.

## Summary of Changes

- **New:** `ArticleExt.kt` — one-liner extension `Article.computeNormalizedUrl()` delegating to `normalizeUrl(this.url ?: this.givenUrl ?: "")`.
- **ArticleRepository.kt** — `normalizeUrl(datum.article.url ?: datum.article.givenUrl ?: "")` → `datum.article.computeNormalizedUrl()`. Removed stale `import com.jayteealao.trails.common.normalizeUrl`; added `import com.jayteealao.trails.data.local.database.computeNormalizedUrl`.
- **FirestoreSyncManager.kt** — Two sites replaced: `normalizeUrl(remoteArticle.url ?: remoteArticle.givenUrl ?: "")` → `remoteArticle.computeNormalizedUrl()`. Swapped `normalizeUrl` import for `computeNormalizedUrl` import.
- **ArticleListViewModel.kt** — One site replaced in `insertArticle()`: `normalizeUrl(article.url ?: article.givenUrl ?: "")` → `article.computeNormalizedUrl()`. Kept `normalizeUrl` import (still used for three string-typed calls). Added `computeNormalizedUrl` import.
- **UrlNormalizerTest.kt** — Added 4 extension test cases asserting parity: url-wins, givenUrl-fallback, both-non-null-url-wins, both-null-empty-string.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleExt.kt` — created; 12 lines; extension function + KDoc
- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — 2 lines changed (import swap + call site replace)
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` — 3 lines changed (import swap + 2 call site replaces)
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt` — 2 lines changed (import add + 1 call site replace)
- `android/app/src/test/java/com/jayteealao/trails/common/UrlNormalizerTest.kt` — 33 lines added (2 imports + 4 test functions)

## Shared Files (also touched by sibling slices)

- `ArticleRepository.kt` — also touched by `article-repository` and `fts-search-fix` (those slices landed first; this change applied cleanly)
- `FirestoreSyncManager.kt` — also touched by `firestore-dedup` and `firestore-io` (landed first; applied cleanly)
- `ArticleListViewModel.kt` — also touched by `list-viewmodel` (landed first; applied cleanly)

## Notes on Design Choices

- **Extension placement in `data.local.database` (not `common`):** `AppDatabase.kt` already imports `common.normalizeUrl` for its Room migration callback (line 222 of AppDatabase.kt), creating a dependency `data.local.database → common`. Adding the reverse import in `common/UrlNormalizer.kt` would have formed a cycle. The plan's fallback (ArticleExt.kt in the same package as Article) was the correct outcome — call sites already have Article in scope, so no extra import is needed beyond the extension itself.
- **`normalizeUrl` import retained in `ArticleListViewModel.kt`:** Three string-typed call sites (post-unfurl resolved URLs at lines 306/364/430) remain as `normalizeUrl(resolvedUrl)` — they do not operate on Article receivers and forcing them through `computeNormalizedUrl` would require dummy Article construction. Both imports coexist cleanly.
- **4 Article-typed sites replaced (not 6):** The slice definition says "6 sites" but the plan audited this to 4 Article-typed + 5 string-typed (9 total). This implementation targets the 4 Article-typed sites as planned; the slice definition's count is a documentation artifact that the plan already corrected.

## Verification Seams Built

- AC B9 — `Article.computeNormalizedUrl()` produces identical output to prior inline expression → verified by 4 new unit tests in `UrlNormalizerTest.kt` (lines 144–181), each asserting `article.computeNormalizedUrl() == normalizeUrl(article.url ?: article.givenUrl ?: "")`. No runtime device needed; the extension is a pure-function delegation.

## Visual Contract Honored

Not applicable — no `02c-craft.md` present.

## Deviations from Plan

1. **Extension placed in `ArticleExt.kt` (not `UrlNormalizer.kt`):** The plan documented this as the fallback for a circular-dependency scenario (Assumption 1). The cycle was confirmed — `data.local.database.AppDatabase` imports `common.normalizeUrl` — so the fallback applied. All call sites remain unchanged in their import requirements (they already import Article). **Behaviour: zero difference.**

## Anything Deferred

None. This slice was the final planned production change in the refactor series. The 5 intentionally excluded call sites (SyncWorker.kt:110, AppDatabase.kt:222, ArticleListViewModel.kt:318/376/436) remain as string-typed calls — exclusion is by design, not deferral.

## Known Risks / Caveats

None. The extension is a zero-logic delegation. The only risk surface — circular imports — was verified and avoided.

## Freshness Research

No external dependency research needed. This is a pure Kotlin refactor with no library version constraints. Kotlin extension functions on a class from another package require only a visible import with no annotation processing (KSP/kapt) changes. OkHttp (used inside `normalizeUrl`) is already a declared dependency; `ArticleExt.kt` adds no new dependencies.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app cross-cutting-url` — 4 new unit tests cover the extension's delegation contract; verify should run `testDebugUnitTest --tests "com.jayteealao.trails.common.*"` and confirm all 20 pass, plus full-suite green.
- **Option B:** `/wf review simplify-android-app cross-cutting-url` — purely structural reuse change with no behavioural delta; if verify is considered already done by the tests run inline here, skip straight to review.
