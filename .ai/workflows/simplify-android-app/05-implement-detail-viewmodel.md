---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: detail-viewmodel
status: complete
stage-number: 5
created-at: "2026-07-06T00:01:06Z"
updated-at: "2026-07-06T00:01:06Z"
metric-files-changed: 3
metric-lines-added: 62
metric-lines-removed: 40
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "1f36db2"
tags: [behaviour-preserving, viewmodel, refactor, android, cleanup]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-detail-viewmodel.md
  plan: 04-plan-detail-viewmodel.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
    - 05-implement-article-repository.md
  verify: 06-verify-detail-viewmodel.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app detail-viewmodel"
---

# Implement: ArticleDetailViewModel cleanup (B4)

## The Implementation

Four independent quality improvements land in a single behaviour-preserving pass over
`ArticleDetailViewModel`. The most structural of them — replacing the flat 9-element
`combine { values -> ... @Suppress("UNCHECKED_CAST") }` block with two typed intermediate
groups (`ArticleGroup` + `ArchiveGroup`) and a final typed outer combine — eliminates all
nine unchecked casts. The compiler now verifies each field assignment; no `@Suppress` annotation
remains in the file.

The other three changes are smaller and symmetrical with patterns already used elsewhere in
the codebase. `UrlModifier` gains `@Singleton` and an `@Inject constructor`; the ViewModel
receives it as a constructor parameter, eliminating three identical `val modifier = UrlModifier()`
local allocations. `"USE_FREEDIUM"` string literals are replaced by
`SettingsPreferenceKeys.USE_FREEDIUM` — the const that `SettingsViewModel` already uses.
Magic strings `"readability"` / `"markdown"` in `autoPopulateText()` become
`ArchiveType.READABILITY.archiveKey` / `ArchiveType.MARKDOWN.archiveKey`, consistent with
how the rest of the ViewModel already references enum constants.

A new `ArticleDetailViewModelTest` (9 tests) covers state assembly, the preference-key
filter, URL-modifier delegation, and the archive-key selection logic. Tests needed a
subscriber on the `WhileSubscribed(5000)` StateFlow (`launchIn(this)`) to activate the
upstream combine chain — without that, the state stays at `initialValue` and assertions
would spuriously pass the initial value.

## Summary of Changes

- `UrlModifier.kt` — added `@Singleton` + `@Inject constructor()`. No logic change.
- `ArticleDetailViewModel.kt` — injected `urlModifier: UrlModifier`; added
  `ArticleGroup`/`ArchiveGroup` private data classes and two intermediate `combine()` flows;
  replaced flat 9-element combine with nested typed combine; replaced `"USE_FREEDIUM"`
  literals (3 occurrences) with `SettingsPreferenceKeys.USE_FREEDIUM`; replaced
  `"readability"` / `"markdown"` literals with enum references; removed three local
  `UrlModifier()` allocations; removed `@Suppress("UNCHECKED_CAST")`.
- `ArticleDetailViewModelTest.kt` — new file (9 tests).

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/common/UrlModifier.kt`
  — Added `@Singleton`, `@Inject constructor()`, two new imports. No functional change.
- `android/app/src/main/java/com/jayteealao/trails/screens/articleDetail/ArticleDetailViewModel.kt`
  — Primary: all 4 quality/reuse items. Added `SettingsPreferenceKeys` import, `SharingStarted`
  direct import (removed `kotlinx.coroutines.flow.SharingStarted` qualified references),
  removed `UrlModifier()` local calls, restructured combine logic, replaced string literals.
- `android/app/src/test/java/com/jayteealao/trails/screens/articleDetail/ArticleDetailViewModelTest.kt`
  — New test file, 9 tests.

## Shared Files (also touched by sibling slices)

None. `UrlModifier` is consumed only by `ArticleDetailViewModel` (confirmed by grep; no
sibling slice touches it). `ArchiveType`, `SettingsPreferenceKeys`, and `LocalArchive` are
read-only here — their definitions are unchanged.

## Notes on Design Choices

- **`WhileSubscribed` subscriber requirement in tests.** The state `StateFlow` uses
  `SharingStarted.WhileSubscribed(5000)` — intentional for production (pauses collection
  when there are no UI observers). In tests, this means the upstream combine chain only
  activates when a collector exists. All test methods subscribe with
  `viewModel.state.onEach { }.launchIn(this)` before asserting state.
- **`TestCoroutineScheduler` sharing.** Both `Dispatchers.setMain(testDispatcher)` and the
  ViewModel's `ioDispatcher` receive the same `testDispatcher` (same scheduler). This
  ensures `advanceUntilIdle()` drains both the viewModelScope coroutines and the IO
  coroutines in a single call — the pattern established by `ArticleListViewModelTest`.
- **No `CommonModule.kt` created.** `UrlModifier` has an `@Inject constructor` with
  `@Singleton`. Hilt resolves it automatically in `SingletonComponent` without an explicit
  `@Provides` method — plan step 2 correctly identified this as the expected path.

## Verification Seams Built

- `stateAssembly_initialState_hasDefaultValues` → reads all 9 state fields on `state.value`;
  confirms no cast exception thrown during state assembly (quality-4 seam).
- `stateAssembly_getArticle_populatesArticleField` → drives getArticle() through the IO
  dispatcher; asserts `article` field populated (state assembly correctness).
- `stateAssembly_setSelectedTab_updatesTabIndex` → direct MutableStateFlow mutation flowing
  through combined state; asserts tabIndex propagated (nested combine round-trip).
- `useFreediumFlow_unrelatedKey_doesNotChangeUseFreedium` → emits `"DARK_MODE_ENABLED"`;
  asserts `useFreedium` stays false (filter boundary, quality-6 seam).
- `useFreediumFlow_correctKey_updatesUseFreedium` → emits `SettingsPreferenceKeys.USE_FREEDIUM`;
  asserts `useFreedium` becomes true (quality-6 seam).
- `getArticle_useFreediumTrue_callsInjectedUrlModifier` → MockK verify that the injected
  `urlModifier.modifyUrl()` is called (reuse-5 seam).
- `getArticle_useFreediumFalse_doesNotCallUrlModifier` → MockK verify zero calls when
  `useFreedium=false` (reuse-5 negative path).
- `autoPopulateText_prefersReadabilityOverMarkdown` → archives list with markdown-first
  ordering; asserts `readArchiveText(READABILITY)` called, `readArchiveText(MARKDOWN)` not
  called (reuse-11 enum-key seam).
- `autoPopulateText_markdownFallback_whenNoReadability` → only markdown archive present;
  asserts markdown text read (reuse-11 fallback seam).

## Deviations from Plan

1. **Combined Steps 2-5 into a single file rewrite.** The plan listed steps 2-5 as separate
   ViewModel edits. All edits target the same file (`ArticleDetailViewModel.kt`), so they
   were applied in a single atomic write rather than 4 sequential edits. The code produced is
   identical to applying them sequentially — no semantic difference.

## Anything Deferred

None. All four items from the slice scope (quality-4, quality-6, reuse-5, reuse-11) are
implemented and tested. No `sdlc-debt:` markers were needed — no intentional simplifications
with known ceilings were taken.

## Known Risks / Caveats

None. The change is behaviour-preserving: observable state shape is unchanged, `stateIn()`
parameters (`WhileSubscribed(5000)`, `viewModelScope`) are unchanged, all 9 source flows
still participate in the combined state.

## Assumptions

1. `UrlModifier` holds no per-instance mutable state (confirmed: only `val` compiled Regex
   fields). `@Singleton` promotion is safe.
2. `ArchiveType` enum definition is unchanged by this slice — only the local string literals
   in `autoPopulateText()` are replaced with enum references.
3. No sibling slice touches `UrlModifier`, `SettingsPreferenceKeys`, or
   `ArticleDetailViewModel` — verified by reviewing the sibling implement artifacts.
4. Hilt resolves `@Singleton @Inject constructor()` without an explicit `@Provides` module
   (confirmed by full test suite passing, which exercises Hilt compilation).

## Freshness Research

No external API or library changes affect this slice. The nested-combine pattern, `@Singleton`
with `@Inject constructor`, and `SettingsPreferenceKeys` usage are all stable in-repo
patterns (see `SettingsViewModel`). No web search was needed.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app detail-viewmodel` — run the new
  `ArticleDetailViewModelTest` suite (already confirmed green locally) and check full suite
  for regressions.
- **Option B:** `/wf review simplify-android-app detail-viewmodel` — skip verify; all
  changes are behaviour-preserving structural refactors with full test coverage already
  confirmed.
