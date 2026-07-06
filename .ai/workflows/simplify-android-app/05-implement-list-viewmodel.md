---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: list-viewmodel
status: complete
stage-number: 5
created-at: "2026-07-06T00:17:58Z"
updated-at: "2026-07-06T00:17:58Z"
metric-files-changed: 4
metric-lines-added: 43
metric-lines-removed: 50
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: ""
tags: [behaviour-preserving, viewmodel, repository-boundary, dead-code]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-list-viewmodel.md
  plan: 04-plan-list-viewmodel.md
  siblings:
    - 05-implement-article-repository.md
    - 05-implement-detail-viewmodel.md
  verify: 06-verify-list-viewmodel.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app list-viewmodel"
---

# Implement: ArticleListViewModel cleanup (B5)

## The Implementation

Six direct DAO call-sites across three methods, two dead declarations, and a pass-through
use case have been eliminated from `ArticleListViewModel`. The ViewModel now talks exclusively
through `ArticleRepository` — confirmed both structurally (no `ArticleDao` in the constructor
graph) and behaviourally (three updated/new tests asserting repo-level call counts). The deleted
`GetArticleWithTextUseCase` was a one-liner wrapping `articleRepository.pockets()`; the Pager
now calls that method directly, removing an unnecessary indirection with no observable effect.

Three thin delegation methods were added to the `ArticleRepository` interface and
`ArticleRepositoryImpl`: `saveNewArticle`, `upsertArticle`, and `updateUnfurledDetails`. Each
is a single-expression body delegating straight to the corresponding DAO method, preserving the
`@Transaction` annotation that Room applies at the DAO call boundary. No re-dispatch, no new
transaction wrappers, no added logic.

The single deviation from plan: the test file already had a `saveUrl calls backupArticleNow and
syncToFirestore after unfurl` test that was still referencing `articleDao` mocks — it was
migrated to repo-level stubs alongside the other tests rather than being left in a mixed state.
This is a tightening of scope, not a broadening.

## Summary of Changes

- Added `saveNewArticle`, `upsertArticle`, `updateUnfurledDetails` to `ArticleRepository` interface
- Implemented the same three methods in `ArticleRepositoryImpl` as thin DAO delegations
- `ArticleListViewModel`: removed `articleDao` and `getArticleWithTextUseCase` constructor params;
  deleted dead `_articles` field and empty `sync()` method; replaced 6 DAO call-sites with repo
  calls; replaced `getArticleWithTextUseCase()` with `articleRepository.pockets()` in the Pager
- Deleted `GetArticleWithTextUseCase.kt` (no remaining callers)
- Updated `ArticleListViewModelTest`: removed DAO and use-case mocks; migrated all DAO stubs to
  repo-level stubs; updated both ViewModel constructor call sites; added
  `saveUrl routes data access through repository not DAO` test

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — added 3 interface methods + 3 impl bodies (+21 lines)
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt` — removed 2 constructor params, deleted `_articles` + `sync()`, replaced 6 DAO call-sites + 1 use-case call (-30 lines, +5 lines net)
- `android/app/src/main/java/com/jayteealao/trails/usecases/GetArticleWithTextUseCase.kt` — deleted (-10 lines)
- `android/app/src/test/java/com/jayteealao/trails/screens/articleList/ArticleListViewModelTest.kt` — updated mocks, constructor calls, added new test (+22 lines, -10 lines net)

## Shared Files (also touched by sibling slices)

- `ArticleRepository.kt` — also touched by `article-repository` (B3). B3 landed first; this slice extends the same file with three new methods. No conflict.
- `ArticleListViewModel.kt` — will also be touched by `cross-cutting-url` (B9). B5 landed first as planned; B9 implementer must pick up the rebased file with DAO→repo renames already applied.

## Notes on Design Choices

- **No re-dispatch in impl bodies:** The plan explicitly required no `withContext` or
  `viewModelScope.launch` inside the repository delegation — the DAO's `@Transaction` applies
  at the Room boundary regardless of call depth. Honoured.
- **`Article` import kept in ViewModel:** The type is still used as a parameter in
  `insertArticle(article: Article)` and in `saveUrl()`'s `Article(...)` constructor call.
- **Existing `saveUrl calls backupArticleNow` test migrated:** This test was already present and
  still referencing `articleDao` mocks; migrating it to repo-level stubs was necessary for it to
  compile and pass after the DAO removal. Recorded as a deviation (plan did not mention migrating
  this second test).

## Verification Seams Built

- `saveUrl routes data access through repository not DAO` test at `ArticleListViewModelTest.kt:157`
  — enables unit runner (`./gradlew :app:testDebugUnitTest`) to assert that `saveNewArticle` and
  `updateUnfurledDetails` are called exactly once through the repo mock with no DAO in the graph.
- Structural seam: `ArticleListViewModel` constructor no longer accepts `ArticleDao` — Hilt's
  compile-time DI validation enforces this at build time for every future change.

## Visual Contract Honored (only if `02c-craft.md` was present)

Not applicable — no design artifact for this slice.

## Deviations from Plan

1. **Existing second test also migrated to repo stubs** — the plan described migrating one test
   (`saveUrl_whenMetadataFetchFails_usesSharedUrlAndTitleFallback`) but the file had a second
   test (`saveUrl calls backupArticleNow and syncToFirestore after unfurl`) that also used
   `articleDao` mocks. Both were migrated. This is a tightening of scope within the slice
   boundary, not a broadening.

## Anything Deferred

- `cross-cutting-url` (B9) will subsequently modify `ArticleListViewModel.kt` to replace
  inline `normalizeUrl()` calls with `Article.computeNormalizedUrl()`. The B9 implementer
  must rebase from the post-B5 file where DAO→repo renames are already applied.

## Known Risks / Caveats

None. The three new repo methods are thin delegations with no added logic. Transaction semantics
preserved at the DAO layer. `ioDispatcher` usage unchanged in all action methods.

## Freshness Research

No new external constraints for this slice — reusing findings from `02-shape.md`. The
`@Transaction` behaviour on `upsertNewArticle` is at the DAO layer and is unaffected by repo
delegation. No Hilt, Room, or coroutine-scope freshness constraints apply.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app list-viewmodel` — unit tests already
  pass; verify runs the full suite and produces the formal verification record.
- **Option B:** `/wf review simplify-android-app list-viewmodel` — skip verify if the team is
  satisfied by the compile + test run recorded here.
