---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: cross-cutting-url
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 6
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, cross-cutting, reuse]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-cross-cutting-url.md
  siblings:
    - 03-slice-detail-viewmodel.md
    - 03-slice-list-viewmodel.md
    - 03-slice-article-repository.md
  implement: 05-implement-cross-cutting-url.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app cross-cutting-url"
---

# Plan: Shared URL Normalization Extension (B9 / reuse-10)

## Current State

`UrlNormalizer.kt` already contains a well-tested top-level function `normalizeUrl(url: String): String` that handles deduplication normalization (lowercase scheme/host, strip tracking params/fragment, sort remaining params, remove trailing slash from non-root paths). A full `UrlNormalizerTest` test class with 16 cases already covers this function.

**Normalization call sites found (9 total):**

| File | Line | Expression | Type |
|---|---|---|---|
| `data/ArticleRepository.kt` | 172 | `normalizeUrl(datum.article.url ?: datum.article.givenUrl ?: "")` | Article-typed |
| `services/firestore/FirestoreSyncManager.kt` | 89 | `normalizeUrl(remoteArticle.url ?: remoteArticle.givenUrl ?: "")` | Article-typed |
| `services/firestore/FirestoreSyncManager.kt` | 106 | `normalizeUrl(remoteArticle.url ?: remoteArticle.givenUrl ?: "")` | Article-typed |
| `screens/articleList/ArticleListViewModel.kt` | 264 | `normalizeUrl(article.url ?: article.givenUrl ?: "")` | Article-typed |
| `screens/articleList/ArticleListViewModel.kt` | 318 | `normalizeUrl(url)` | String-typed (resolved URL) |
| `screens/articleList/ArticleListViewModel.kt` | 376 | `normalizeUrl(resolvedUrl)` | String-typed (resolved URL) |
| `screens/articleList/ArticleListViewModel.kt` | 436 | `normalizeUrl(resolvedUrl)` | String-typed (resolved URL) |
| `sync/workers/SyncWorker.kt` | 110 | `normalizeUrl(resolvedUrl)` | String-typed (resolved URL) |
| `data/local/database/AppDatabase.kt` | 222 | `normalizeUrl(raw)` | String-typed (migration cursor row) |

**Byte-identical audit (CRITICAL):** All 9 sites call the same `normalizeUrl(String)` top-level function — they are byte-identical in semantics. There is NO divergence. No behaviour unification risk.

**Actual duplication pattern:** 4 sites share the identical null-coalescing URL-selection idiom `article.url ?: article.givenUrl ?: ""` (or equivalent with different local variable name) on an `Article`-typed receiver. These 4 are the canonical duplication targets for `Article.computeNormalizedUrl()`. The remaining 5 sites operate on already-resolved URL strings — they are NOT Article-typed and should NOT be rewritten through the extension.

## Reuse Opportunities

**reuse-10 (B9):** `Article.computeNormalizedUrl()` extension delegates to `normalizeUrl(this.url ?: this.givenUrl ?: "")`. Eliminates 4 repeated inline null-coalescing URL-selection expressions. Zero behaviour change — the extension is a one-liner that delegates directly to the existing function.

The existing `UrlNormalizerTest` already pins the `normalizeUrl` function's output comprehensively. The new test additions pin only the extension's delegation and the Article field-selection logic.

## Likely Files / Areas to Touch

**4 production files + 1 test file (5 total writes):**

1. `android/app/src/main/java/com/jayteealao/trails/common/UrlNormalizer.kt` — add the extension fun (new, 12 lines)
2. `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — 1 call site replaced (line 172)
3. `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` — 2 call sites replaced (lines 89, 106)
4. `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt` — 1 call site replaced (line 264); 3 string-typed calls unchanged
5. `android/app/src/test/java/com/jayteealao/trails/common/UrlNormalizerTest.kt` — add extension test cases

**Explicitly excluded (intentional):**
- `sync/workers/SyncWorker.kt:110` — `normalizeUrl(resolvedUrl)` operates on a resolved URL string post-unfurl; not Article-typed
- `data/local/database/AppDatabase.kt:222` — operates inside a SQL migration cursor loop on a raw String; not Article-typed
- `screens/articleList/ArticleListViewModel.kt:318/376/436` — three calls on resolved URL strings (post-unfurl); not Article-typed

## Proposed Change Strategy

**One-liner extension + surgical replaces.** Add `Article.computeNormalizedUrl()` to `UrlNormalizer.kt` (same file as `normalizeUrl`, keeps the normalization logic co-located). Replace the 4 Article-typed inline null-coalescing calls with the extension. Update imports. Extend the existing test file with Article-extension cases. No new files, no DI changes, no behavioural change.

## Step-by-Step Plan

**Step 1 — Add `Article.computeNormalizedUrl()` to `UrlNormalizer.kt`**

After the existing `normalizeUrl(url: String)` function, add:

```kotlin
import com.jayteealao.trails.data.local.database.Article

/**
 * Computes the normalized URL for deduplication using the article's resolved URL
 * (url field preferred; falls back to givenUrl; empty string if both null).
 * Delegates to [normalizeUrl] — output is byte-identical to the inline expression
 * `normalizeUrl(article.url ?: article.givenUrl ?: "")`.
 */
fun Article.computeNormalizedUrl(): String =
    normalizeUrl(this.url ?: this.givenUrl ?: "")
```

**Step 2 — Replace in `ArticleRepository.kt` (line 172)**

```kotlin
// Before:
normalizedUrl = normalizeUrl(datum.article.url ?: datum.article.givenUrl ?: ""),
// After:
normalizedUrl = datum.article.computeNormalizedUrl(),
```
Remove the `import com.jayteealao.trails.common.normalizeUrl` if `computeNormalizedUrl` is the only remaining call; add `import com.jayteealao.trails.common.computeNormalizedUrl` (or it resolves via the same package if co-located with Article import).

**Step 3 — Replace in `FirestoreSyncManager.kt` (lines 89, 106)**

```kotlin
// Before (both occurrences):
normalizedUrl = normalizeUrl(remoteArticle.url ?: remoteArticle.givenUrl ?: "")
// After:
normalizedUrl = remoteArticle.computeNormalizedUrl()
```
Update import.

**Step 4 — Replace in `ArticleListViewModel.kt` (line 264 only)**

```kotlin
// Before:
normalizedUrl = normalizeUrl(article.url ?: article.givenUrl ?: "")
// After:
normalizedUrl = article.computeNormalizedUrl()
```
Keep `import com.jayteealao.trails.common.normalizeUrl` — it is still used at lines 318/376/436 for string-typed calls.

**Step 5 — Add extension test cases to `UrlNormalizerTest.kt`**

Add a new test class or block `Article.computeNormalizedUrl` extension tests:

```kotlin
// At minimum 4 cases:
// 1. url non-null → delegates to normalizeUrl(url)
// 2. url null, givenUrl non-null → delegates to normalizeUrl(givenUrl)
// 3. both non-null → url wins (matches normalizeUrl(url ?: givenUrl ?: ""))
// 4. both null → normalizeUrl("") == "" (graceful empty fallback)
// Each asserts: article.computeNormalizedUrl() == normalizeUrl(article.url ?: article.givenUrl ?: "")
```

**Step 6 — Run unit tests**

```
cd android && ./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.common.*"
```

Green = done. No interactive verification needed for this slice.

## Test / Verification Plan

**Automated only (behaviour-preserving, no interactive step):**

- Gradle task: `./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.common.*"`
  - Existing 16 `UrlNormalizerTest` cases continue to pass (regression guard on `normalizeUrl`)
  - New Article extension cases assert byte-for-byte parity: `article.computeNormalizedUrl() == normalizeUrl(article.url ?: article.givenUrl ?: "")`
- After landing: confirm `./gradlew :app:testDebugUnitTest` (full unit suite) stays green — catches any import errors in the 3 call-site files

No Compose UI tests, no instrumented tests, no interactive verification — the only change is call-site wiring and a delegating extension.

## Risks / Watchouts

**Low** — AppDatabase.kt migration callback (line 222) calls `normalizeUrl(raw)` where `raw` is a String from a cursor row, not an Article. This is intentionally excluded from the extension replacement; leave it as-is. No behaviour difference.

**Low** — SyncWorker.kt and the 3 string-typed calls in ArticleListViewModel.kt are intentionally excluded. They operate on already-resolved URL strings post-unfurl, not Article objects. Forcing them through computeNormalizedUrl() would require a dummy Article construction — wrong abstraction, no benefit.

**Med — Conflict surface (sequence this LAST):** The 3 files overlap other slices:
- `ArticleRepository.kt` → also touched by `article-repository` (B3) and `fts-search-fix` (A1)
- `FirestoreSyncManager.kt` → also touched by `firestore-dedup` (B1) and `firestore-io` (B2)
- `ArticleListViewModel.kt` → also touched by `list-viewmodel` (B5)

Land `cross-cutting-url` AFTER all 5 of those slices are settled and merged, or rebase carefully. The changes in this slice are small surgical replaces (1-2 lines each) that should apply cleanly once the structural changes in the sibling slices are stable.

## Dependencies on Other Slices

- No hard blocking dependencies — this slice can compile independently.
- Soft sequencing: land AFTER `article-repository`, `fts-search-fix`, `firestore-dedup`, `firestore-io`, `list-viewmodel` to minimize rebase churn. (See Risks above.)

## Assumptions

1. `Article` is imported into `UrlNormalizer.kt` without a circular dependency — `common/` does not import from `data/local/database/` today, so this needs care. **Alternative:** place the extension in a new `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleExt.kt` (same package as `Article`) if the cross-package import creates a cycle. Implementation step checks the actual package graph.
2. The 4 Article-typed call sites all have an `Article` receiver in scope (confirmed: `datum.article`, `remoteArticle`, `remoteArticle`, `article` — all are `data.local.database.Article` instances).
3. No other call sites were missed — the grep across all `.kt` sources in `android/app/src/` is exhaustive (9 sites found, 4 Article-typed).

## Blockers

None.

## Freshness Research

From `02-shape.md` Freshness Research (carried; no new web search needed — this is a pure Kotlin refactor):

- No library version constraints apply to a Kotlin extension function addition.
- Kotlin extension functions on a data class from another package require only a visible import; no annotation processing (KSP/kapt) changes.
- The `normalizeUrl` function uses `okhttp3.HttpUrl.Companion.toHttpUrlOrNull()` — OkHttp dependency is already declared in the app module; the extension adds no new dependencies.

**Circular dependency check (assumption 1 above):** If `common/UrlNormalizer.kt` cannot import `data.local.database.Article` without a cycle, the extension moves to `data/local/database/ArticleExt.kt` — same `data.local.database` package, zero additional import needed in call sites (already have Article in scope). This is the fallback. The implementer must check the module graph; both placements are documented here.

## Revision History

_(empty — initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app cross-cutting-url` — sequence after `article-repository`, `firestore-dedup`, `firestore-io`, and `list-viewmodel` are merged to minimize rebase work.
