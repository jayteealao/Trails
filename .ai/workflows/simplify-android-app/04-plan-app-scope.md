---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: app-scope
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 5
metric-step-count: 8
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-change, di, reliability]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-app-scope.md
  siblings:
    - 03-slice-test-net.md
    - 03-slice-firestore-dedup.md
    - 03-slice-article-repository.md
  implement: 05-implement-app-scope.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app app-scope"
---

# Plan: Shared @ApplicationScope coroutine scope (quality-1 / A4)

## Current State

`ArticleRepositoryImpl` constructs a bare, unsupervised scope at field-initialisation time:

```kotlin
// ArticleRepository.kt line 135
private val coroutineScope = CoroutineScope(ioDispatcher)
```

`FirestoreSyncManager` constructs its own ad-hoc supervised scope also at field-initialisation:

```kotlin
// FirestoreSyncManager.kt line 57
private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
```

Problems:
1. `ArticleRepositoryImpl.coroutineScope` has no `SupervisorJob`. A single failing child (e.g. the `syncLocalChanges()` call in `add()` or the Firestore soft-delete in `delete()`) cancels the entire scope and permanently breaks all subsequent launches in that singleton.
2. `FirestoreSyncManager.scope` is supervised but private and isolated — not shared with the rest of the app.
3. `cleanup()` calls `scope.cancel()`. Once the scope becomes shared/singleton, cancelling it here would silently kill background work app-wide.
4. No `@ApplicationScope` qualifier or shared provider exists anywhere in the DI graph.

## Reuse Opportunities

- `DispatchersModule` already provides `@Dispatcher(TrailsDispatchers.IO) CoroutineDispatcher` in `SingletonComponent`. The new `AppScopeModule` reuses that provider as its dispatcher parameter — no new dispatcher needed.
- The new `@ApplicationScope` qualifier follows the same pattern as the existing `@Dispatcher` qualifier in `common/di/dispatchers/TrailsDispatchers.kt`.
- `DataModule` uses `@Binds` on `ArticleRepositoryImpl`; Hilt resolves constructor parameters automatically, so no manual `@Provides` change is required in `DataModule` — it stays as-is.

## Likely Files / Areas to Touch

| File | Change |
|---|---|
| `common/di/AppScopeModule.kt` | NEW — qualifier + provider |
| `data/ArticleRepository.kt` | Modified — inject scope, remove bare init |
| `services/firestore/FirestoreSyncManager.kt` | Modified — inject scope, remove ad-hoc init, neuter cleanup() |
| `data/di/DataModule.kt` | Verified (no edit needed; Hilt resolves automatically) |
| `test/…/common/di/AppScopeIsolationTest.kt` | NEW — supervised-isolation unit test |

## Proposed Change Strategy

One minimal pass, hard cutover:

1. Add the `@ApplicationScope` qualifier and `AppScopeModule` provider in the `common/di/` package alongside `DispatchersModule`.
2. Inject `@ApplicationScope CoroutineScope` into `ArticleRepositoryImpl`; delete the bare field initialiser and the `ioDispatcher` constructor param (audit shows no remaining usage after removal).
3. Inject `@ApplicationScope CoroutineScope` into `FirestoreSyncManager`; delete the ad-hoc field initialiser; in `cleanup()` replace `scope.cancel()` with a no-op comment.
4. Write the supervised-isolation unit test; run `./gradlew :app:testDebugUnitTest` to confirm green.

No shims, no deprecation path — all callers are in-app and updated in this one slice.

## Step-by-Step Plan

**Step 1 — Create `@ApplicationScope` qualifier**
In `android/app/src/main/java/com/jayteealao/trails/common/di/AppScopeModule.kt`:
```kotlin
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class ApplicationScope
```

**Step 2 — Add `AppScopeModule` Hilt provider**
In the same file, add:
```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AppScopeModule {
    @Provides
    @Singleton
    @ApplicationScope
    fun provideApplicationScope(
        @Dispatcher(TrailsDispatchers.IO) ioDispatcher: CoroutineDispatcher
    ): CoroutineScope = CoroutineScope(SupervisorJob() + ioDispatcher)
}
```

**Step 3 — Update `ArticleRepositoryImpl` constructor**
- Add `@ApplicationScope private val coroutineScope: CoroutineScope` parameter (after existing params, replacing ioDispatcher).
- Remove `@Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher` (audit: no remaining usage in impl after scope removal).
- Delete the `private val coroutineScope = CoroutineScope(ioDispatcher)` property initialiser.
- The four launch/async sites (`add`, `delete`, `synchronize`, `searchHybrid`) use `coroutineScope` by the same name — no body edits needed.

**Step 4 — Update `FirestoreSyncManager` constructor**
- Add `@ApplicationScope private val scope: CoroutineScope` parameter (after existing params).
- Delete `private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)` property initialiser.
- Remove `import kotlinx.coroutines.SupervisorJob` (no longer used in this file; `Dispatchers.IO` stays for `withContext` calls).
- In `cleanup()`, replace `scope.cancel()` with:
  ```kotlin
  // scope is an @ApplicationScope @Singleton — do NOT cancel it here; it is app-lifetime managed
  ```

**Step 5 — Verify `DataModule` needs no change**
`DataModule` binds `ArticleRepositoryImpl` via `@Binds`. Hilt infers constructor params from `@Inject`; the new `@ApplicationScope CoroutineScope` param is satisfied automatically once Step 2 is complete. Confirm by inspecting the file (already done — no `@Provides` lists the old constructor).

**Step 6 — Write supervised-isolation unit test**
Create `android/app/src/test/java/com/jayteealao/trails/common/di/AppScopeIsolationTest.kt`:
- Build `CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))`.
- Launch child A that throws `IllegalStateException`.
- `advanceUntilIdle()`.
- Assert `scope.isActive == true`.
- Launch child B that increments a counter.
- `advanceUntilIdle()`.
- Assert counter == 1 (sibling unaffected).
- Assert scope is NOT cancelled.
- Do NOT call `scope.cancel()` at any point in the test body (validates app-lifetime semantics).

**Step 7 — Run verification**
```
./gradlew :app:testDebugUnitTest
```
Expected: new `AppScopeIsolationTest` passes; existing `DefaultArticleRepositoryTest` (currently a stub) stays green; no other unit test regressions.

**Step 8 — Review checklist**
- [ ] `FirestoreSyncManager.cleanup()` does not cancel the shared scope.
- [ ] No `CoroutineScope(ioDispatcher)` bare-scope patterns remain in the two changed files.
- [ ] `AppScopeModule` is in `SingletonComponent`.
- [ ] Isolation test passes without real Firebase / WorkManager.

## Test / Verification Plan

**Automated (only — no interactive verification needed for this slice):**

| Test | File | Gradle task |
|---|---|---|
| `AppScopeIsolationTest` — child failure does not cancel scope or siblings | `test/…/common/di/AppScopeIsolationTest.kt` | `./gradlew :app:testDebugUnitTest` |

The test uses `StandardTestDispatcher` + `SupervisorJob()` to drive coroutines synchronously. No Firebase, no WorkManager, no MockK required for the isolation assertion itself.

Existing tests that remain green after constructor changes (both currently stubs — will not regress):
- `DefaultArticleRepositoryTest`

## Risks / Watchouts

**HIGH — `cleanup()` cancels the shared scope**
`FirestoreSyncManager.cleanup()` currently calls `scope.cancel()`. After this slice the scope is a `@Singleton`; calling cancel here silently kills all future coroutines in `ArticleRepositoryImpl` and any future consumer, for the lifetime of the process. Must be neutered (see Step 4).

**MED — `ioDispatcher` removal from `ArticleRepositoryImpl` constructor is a secondary change**
`ioDispatcher` becomes dead after the scope is injected. Removing it is the correct cleanup but is a constructor change that Hilt resolves automatically. Verify no `withContext(ioDispatcher)` or similar call survives in the impl body before removal.

**MED — CROSS-SLICE constructor churn**
`ArticleRepository.kt` is also edited by `fts-search-fix` (method body, no constructor) and `article-repository` (constructor — inject Firebase, bulk add). `FirestoreSyncManager.kt` body is edited by `firestore-dedup`. This slice MUST be merged before those slices begin editing these files to avoid double-edit merge conflicts.

**LOW — Test dispatcher / real dispatcher mixing**
If `AppScopeIsolationTest` accidentally imports `Dispatchers.IO` instead of `StandardTestDispatcher`, the supervised-isolation assertion may pass trivially (no real work runs). Use `StandardTestDispatcher` exclusively.

## Dependencies on Other Slices

| Slice | Direction | Dependency |
|---|---|---|
| `test-net` | prerequisite | Provides test harness foundation; app-scope isolation test is self-contained (no net harness needed), but sequencing follows the DAG |
| `firestore-dedup` (B1) | dependent | Consumes the `@ApplicationScope` scope from this slice; edits `FirestoreSyncManager` body — must land after app-scope |
| `article-repository` (B3) | dependent | Edits `ArticleRepositoryImpl` body and may adjust constructor — must land after app-scope |

## Assumptions

1. `ArticleRepositoryImpl.ioDispatcher` has no remaining usage after the scope is moved to injection. (Verified by reading the full impl: no `withContext(ioDispatcher)` call exists — only the removed `CoroutineScope(ioDispatcher)` initialiser used it.)
2. `FirestoreSyncManager.scope` field is only used for `scope.cancel()` in `cleanup()` — all other coroutine launches are `suspend` functions called from an outer scope (WorkManager coroutine, or the injected scope). (Verified by reading the full class: `scope` field is declared but only used in `cleanup()`; `syncLocalChanges()` and `performFullSync()` are `suspend` funs called by callers that own their own scope.)
3. No other class directly calls `FirestoreSyncManager.cleanup()` in a test that asserts `scope.cancel()` was called. (No such test found in the test tree.)
4. `DataModule` requires no edit — confirmed by file read.

## Blockers

None. All information required to implement is available from static analysis.

## Freshness Research

From `02-shape.md` § Freshness Research (coroutine scope):

> **Coroutine scope (quality-1)** — `CoroutineScope(SupervisorJob() + dispatcher)` under `@Singleton @ApplicationScope`; bare `CoroutineScope(dispatcher)` dies on first child exception. Source: Android/Manuel Vivo Hilt-scope guidance.

No additional web search required. The pattern (`@Qualifier` + `@Singleton` provider with `SupervisorJob()`) is fully described. The `@Dispatcher(TrailsDispatchers.IO)` dispatcher provider is confirmed present in `DispatchersModule.kt`.

## Revision History

_(none — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app app-scope` — all implementation information is above; the implementer can proceed directly without further research.
