---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: detail-viewmodel
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 5
metric-step-count: 10
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, viewmodel, refactor, android, cleanup]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-detail-viewmodel.md
  siblings:
    - 03-slice-list-viewmodel.md
    - 03-slice-cross-cutting-url.md
  implement: 05-implement-detail-viewmodel.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app detail-viewmodel"
---

# Plan: ArticleDetailViewModel cleanup (B4)

## Current State

`ArticleDetailViewModel.kt` has four cleanliness issues identified in triage:

**quality-4 — 9-element flat `combine()` with 9 unchecked casts (lines 71–100)**

```kotlin
combine(
    _article, _selectedTabIndex, useFreediumFlow, _isLoading,
    _remoteArchives, _localArchives, _archiveSyncing, _textSource, _selectedArchiveContent,
) { values ->
    @Suppress("UNCHECKED_CAST")
    ArticleDetailState(
        article = values[0] as Article?,
        selectedTabIndex = values[1] as Int,
        // … 7 more casts
    )
}
```

Kotlin's `combine()` overloads only exist up to 5 arguments with typed lambdas; 6+ must use the `Array<*>` variant, which loses type information and forces unchecked casts. The fix is nested typed `combine()` groups — identical to the `SettingsViewModel` pattern already in the codebase.

**quality-6 — stringly-typed preference key in three places (lines 60, 67, 98)**

```kotlin
.filter { it == "USE_FREEDIUM" }       // line 60
sharedPreferencesManager.getBoolean(it!!)  // implicit — no key const
sharedPreferencesManager.getBoolean("USE_FREEDIUM")  // lines 67, 98
```

`SettingsPreferenceKeys.USE_FREEDIUM = "USE_FREEDIUM"` already exists in `screens/settings/SettingsPreferenceKeys.kt`. `SettingsViewModel` already uses it. `ArticleDetailViewModel` does not.

**reuse-5 — `UrlModifier()` re-created in three places (lines 131, 249, 274)**

```kotlin
val modifier = UrlModifier()   // in getArticle()
val modifier = UrlModifier()   // in autoPopulateText()
val modifier = UrlModifier()   // in loadArchiveContent()
```

`UrlModifier` holds only `val` compiled Regex patterns — no per-instance mutable state. It is safe to promote to `@Singleton` and inject. No other file creates `UrlModifier()` (verified: only `UrlModifier.kt` and `ArticleDetailViewModel.kt` reference the class).

**reuse-11 — magic strings `"readability"` / `"markdown"` in `autoPopulateText()` (lines 226–227)**

```kotlin
val textArchive = archives.firstOrNull { it.archiveKey == "readability" }
    ?: archives.firstOrNull { it.archiveKey == "markdown" }
```

`ArchiveType` enum already exists at `data/archive/ArchiveType.kt` with `READABILITY("readability", …)` and `MARKDOWN("markdown", …)`. The correct references are `ArchiveType.READABILITY.archiveKey` and `ArchiveType.MARKDOWN.archiveKey`. `ArchiveType` is already imported in `ArticleDetailViewModel` (line 12) for other usages.

## Reuse Opportunities

| Finding | Existing asset | Action |
|---|---|---|
| reuse-5 | `UrlModifier` (common/) | Add `@Singleton`, inject via constructor |
| reuse-11 | `ArchiveType` enum (data/archive/) | Replace string literals with enum constant references |
| quality-6 | `SettingsPreferenceKeys` (screens/settings/) | Import and use the const |
| quality-4 | `SettingsViewModel` nested-combine pattern | Apply same two-group nesting |

**Cross-slice consumer scan:**

- `UrlModifier` — referenced only in `ArticleDetailViewModel.kt` (3 call sites). No other consumer. Promoting to `@Singleton` is safe and affects only this slice. The `cross-cutting-url` slice (B9) introduces `Article.computeNormalizedUrl()` — a separate concern, no conflict.
- `ArchiveType` — referenced in 5 files: `ArticleDetailViewModel.kt`, `ArticleDetailScreen.kt`, `ArchiveService.kt`, `SyncWorker.kt`, `ArchiveType.kt` itself. All use enum constants or `fromArchiveKey()` — the enum definition is unchanged by this slice. The `"readability"` / `"markdown"` string literals being replaced are local to `autoPopulateText()` in `ArticleDetailViewModel.kt` only.
- `SettingsPreferenceKeys` — already used by `SettingsViewModel`. Adding the import to `ArticleDetailViewModel` is additive-only.

## Likely Files / Areas to Touch

| File | Status | Role |
|---|---|---|
| `screens/articleDetail/ArticleDetailViewModel.kt` | modified | Primary: all 4 quality/reuse items |
| `common/UrlModifier.kt` | modified | Add `@Singleton` annotation |
| `common/di/CommonModule.kt` | new | `@Provides @Singleton UrlModifier` (if needed) |
| `screens/settings/SettingsPreferenceKeys.kt` | read-only | Source of the const; no change |
| `screens/articleDetail/ArticleDetailViewModelTest.kt` | new | Unit tests: state assembly + all 4 items |

## Proposed Change Strategy

Behaviour-preserving. The Tartlet Store `combine()→stateIn()` pattern is **preserved** — only the implementation of the `combine()` block changes from flat-array-with-casts to two nested typed groups. All 9 state fields remain; their mapping to `ArticleDetailState` is unchanged. No observable state difference.

Two private data classes group the flows:

```kotlin
private data class ArticleGroup(
    val article: Article?,
    val selectedTabIndex: Int,
    val useFreedium: Boolean,
    val isLoading: Boolean,
)
private data class ArchiveGroup(
    val remoteArchives: Map<String, ArchiveStatus>,
    val localArchives: List<LocalArchive>,
    val archiveSyncing: Boolean,
    val textSource: String,
    val selectedArchiveContent: String?,
)
```

Then:

```kotlin
private val articleGroupFlow = combine(
    _article, _selectedTabIndex, useFreediumFlow, _isLoading
) { article, tab, useFreedium, loading ->
    ArticleGroup(article, tab, useFreedium, loading)
}

private val archiveGroupFlow = combine(
    _remoteArchives, _localArchives, _archiveSyncing, _textSource, _selectedArchiveContent
) { remote, local, syncing, textSrc, selectedContent ->
    ArchiveGroup(remote, local, syncing, textSrc, selectedContent)
}

private val _state = combine(articleGroupFlow, archiveGroupFlow) { ag, arc ->
    ArticleDetailState(
        article = ag.article,
        selectedTabIndex = ag.selectedTabIndex,
        useFreedium = ag.useFreedium,
        isLoading = ag.isLoading,
        remoteArchives = arc.remoteArchives,
        localArchives = arc.localArchives,
        archiveSyncing = arc.archiveSyncing,
        textSource = arc.textSource,
        selectedArchiveContent = arc.selectedArchiveContent,
    )
}.stateIn(
    scope = viewModelScope,
    started = SharingStarted.WhileSubscribed(5000),
    initialValue = ArticleDetailState(
        useFreedium = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM)
    )
)
```

## Step-by-Step Plan

1. **Read `UrlModifier.kt`** — confirm no mutable state (done in research: only `val` Regex fields). Add `@Singleton` to the class declaration. Add `javax.inject.Singleton` import.
2. **Check if Hilt module needed** — `UrlModifier` has `@Inject constructor`; with `@Singleton` Hilt will bind it automatically in `SingletonComponent`. If `compileDebugKotlin` passes without a module, skip creating `CommonModule.kt`. If it fails, create `common/di/CommonModule.kt` with a `@Provides @Singleton` binding.
3. **Update `ArticleDetailViewModel` constructor** — add `private val urlModifier: UrlModifier` parameter (Hilt injects the singleton). Remove the three `val modifier = UrlModifier()` local allocations.
4. **Replace string literals** — in the constructor and `useFreediumFlow` definition, replace all `"USE_FREEDIUM"` with `SettingsPreferenceKeys.USE_FREEDIUM`. Add import for `com.jayteealao.trails.screens.settings.SettingsPreferenceKeys`.
5. **Replace magic archive strings** — in `autoPopulateText()`, replace `"readability"` with `ArchiveType.READABILITY.archiveKey` and `"markdown"` with `ArchiveType.MARKDOWN.archiveKey`. (`ArchiveType` import already present.)
6. **Introduce intermediate data classes** — add `private data class ArticleGroup(…)` and `private data class ArchiveGroup(…)` at the top of the file (before `_state`).
7. **Refactor `_state` combine** — replace the 9-element flat `combine { values -> ... }` with `articleGroupFlow`, `archiveGroupFlow`, and the outer typed `combine { ag, arc -> }`. Remove all `@Suppress("UNCHECKED_CAST")` annotations. Keep `stateIn()` call identical (`WhileSubscribed(5000)`, `viewModelScope`).
8. **Update `initialValue`** — replace the `"USE_FREEDIUM"` string literal in the `stateIn()` `initialValue` with `SettingsPreferenceKeys.USE_FREEDIUM`.
9. **Write `ArticleDetailViewModelTest.kt`** — new file covering:
   - State assembly: given 9 known values flowing from the 9 `MutableStateFlow`s, the combined `state` emits an `ArticleDetailState` with correct field values (no cast exceptions).
   - `useFreediumFlow` filter: `preferenceChangesFlow()` emitting `"USE_FREEDIUM"` triggers a recompute; emitting `"DARK_MODE_ENABLED"` does not.
   - UrlModifier injection: the injected `urlModifier` is called in `getArticle()` when `useFreediumFlow` is true; no local constructor calls.
   - Archive key constants: `autoPopulateText()` with a `LocalArchive(archiveKey="readability")` selects readability over markdown.
10. **Run tests** — `./gradlew :app:testDebugUnitTest --tests "*.ArticleDetailViewModelTest"`. All assertions pass; no regressions in existing tests.

## Test / Verification Plan

**Test task:** `./gradlew :app:testDebugUnitTest`

**Targeted run:** `./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.screens.articleDetail.ArticleDetailViewModelTest"`

**Test file:** `android/app/src/test/java/com/jayteealao/trails/screens/articleDetail/ArticleDetailViewModelTest.kt`

**Harness:** MockK + `StandardTestDispatcher` + `Dispatchers.setMain/resetMain` — same pattern as `ArticleListViewModelTest`. No Hilt test infrastructure needed for this VM (constructor injection is manual in tests).

**Coverage assertions:**

| Test | Assertion |
|---|---|
| `stateAssembly_allFieldsMappedCorrectly` | Emit values for all 9 flows; `advanceUntilIdle()`; assert each field on the collected state |
| `useFreediumFlow_filtersByCorrectKey` | `preferenceChangesFlow` emits `"OTHER_KEY"` → state unchanged; emits `"USE_FREEDIUM"` → `useFreedium` flips |
| `getArticle_usesInjectedUrlModifier` | `useFreedium=true`; call `getArticle(id)`; verify `urlModifier.modifyUrl(...)` was called (MockK verify) |
| `autoPopulateText_prefersReadabilityOverMarkdown` | archives = `[markdown, readability]`; confirm readability archive key selected |

**Full suite run:** after targeted pass, run `./gradlew :app:testDebugUnitTest` to confirm no regressions.

**No interactive verification required** — this slice is behaviour-preserving ViewModel-only; no UI composition change.

## Risks / Watchouts

1. **Low — Nested combine() group boundary.** The intermediate data classes (`ArticleGroup`, `ArchiveGroup`) introduce one extra allocation per emission cycle but do not change which values trigger re-emission. All 9 source flows still participate; any emission still propagates to `ArticleDetailState`. Pin with the state-assembly test.

2. **Low — SettingsPreferenceKeys import crosses screen package boundary.** `SettingsPreferenceKeys` lives in `screens/settings/`. Importing into `screens/articleDetail/` is an intra-screens cross-package dependency. This is acceptable per codebase conventions (`SettingsViewModel` already owns it; the const is app-wide). No structural concern.

3. **Low — `UrlModifier @Singleton` Hilt resolution.** `UrlModifier` has an `@Inject constructor` — with `@Singleton`, Hilt resolves it automatically. If the Hilt component graph check (`compileDebugKotlin`) fails, create `CommonModule.kt` as planned. Verify by building before merging.

## Dependencies on Other Slices

- **None hard.** `detail-viewmodel` is listed as independent in `03-slice.md` (depends-on: []).
- **Cross-slice flags:**
  - `UrlModifier` is only consumed by `ArticleDetailViewModel`. No conflict with `cross-cutting-url` (B9), which introduces a separate `Article.computeNormalizedUrl()` extension on the domain model.
  - `ArchiveType` enum definition is unchanged — all other consumers (`ArticleDetailScreen`, `ArchiveService`, `SyncWorker`) use it read-only and are unaffected.
  - `SettingsPreferenceKeys` is read-only from this slice's perspective — `SettingsViewModel` is the only writer, untouched.

## Assumptions

1. `UrlModifier.kt` holds no per-instance mutable state — confirmed by reading the file (only `val URLCHECKPATTERN` and `val PROTOCOL_PATTERN`).
2. `ArchiveType` enum already exists and is already imported in `ArticleDetailViewModel`. reuse-11 is purely a string-to-enum-reference replacement, not a new enum creation.
3. `SettingsPreferenceKeys.kt` is stable and will not be moved or renamed by a sibling slice before this slice lands. (No sibling touches it — `list-viewmodel` B5 touches `ArticleListViewModel` only.)
4. The Tartlet Store's `Store<State, Event>` interface contract requires `state: StateFlow<State>` and `event: SharedFlow<Event>` — neither changes.
5. JVM unit tests for this VM do not require `TestDatabaseModule` or Hilt test infra (the VM uses constructor injection with simple MockK mocks).

## Blockers

None.

## Freshness Research

Reusing `02-shape.md § Freshness Research` (confirmed stack, no new external constraint for this slice):

- **Kotlin `combine()` overloads** — typed-lambda overloads exist for 2–5 `Flow` arguments (`kotlinx.coroutines.flow`). The 6–9 argument form uses `Array<*>` → unchecked cast required. Nested two-level `combine()` restores typed lambdas. No version caveat; this is stable Kotlin coroutines API.
- **Hilt `@Singleton` on a class with `@Inject constructor`** — binds the class in `SingletonComponent` automatically; no `@Provides` module needed unless the binding type differs from the concrete class. Source: Hilt docs / Android Hilt guide.
- No CVEs or version constraints affect this slice.

## Revision History

_(empty — rev 1 is initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app detail-viewmodel`

Run `./gradlew :app:testDebugUnitTest` after implementation to verify the new `ArticleDetailViewModelTest` passes and existing tests stay green.
