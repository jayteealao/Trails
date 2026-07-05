---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: app-scope
status: complete
stage-number: 5
created-at: "2026-07-05T22:31:22Z"
updated-at: "2026-07-05T22:31:22Z"
metric-files-changed: 3
metric-lines-added: 43
metric-lines-removed: 10
metric-deviations-from-plan: 0
metric-review-fixes-applied: 0
commit-sha: ""
tags: [behaviour-change, di, reliability]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-app-scope.md
  plan: 04-plan-app-scope.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
  verify: 06-verify-app-scope.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app app-scope"
---

# Implement: Shared @ApplicationScope coroutine scope (quality-1 / A4)

## The Implementation

Both `ArticleRepositoryImpl` and `FirestoreSyncManager` previously created their own
`CoroutineScope` at field-initialisation time. The repository's scope was unsupervised
(`CoroutineScope(ioDispatcher)` with no `SupervisorJob`), meaning the first child
exception — a failed Firestore soft-delete, a network error in `syncLocalChanges` —
would permanently cancel all future launches in that singleton. The sync manager had a
supervised scope, but it was private, isolated, and cancelled by `cleanup()`, which is
called on configuration changes.

The fix is a single, Hilt-provided `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() + ioDispatcher)`.
Both classes receive it by constructor injection; neither creates a scope of its own
any more. The `cleanup()` neutering is the most important correctness change: the old
`scope.cancel()` call would have silently killed all background work app-wide for the
lifetime of the process once the scope became shared. It is replaced with a comment
explaining why the cancel is intentionally absent.

Two isolation tests pin the supervised-failure semantics: a child throwing must not
tear down the scope, and new launches must succeed after the failure. No external
dependencies are required — `StandardTestDispatcher` + `SupervisorJob()` drives the
assertions synchronously.

## Summary of Changes

- **NEW** `common/di/AppScopeModule.kt` — `@ApplicationScope` qualifier annotation +
  `AppScopeModule` Hilt object providing `@Singleton CoroutineScope(SupervisorJob() + ioDispatcher)`.
- **MODIFIED** `data/ArticleRepository.kt` — replaced `@Dispatcher(IO) ioDispatcher: CoroutineDispatcher`
  constructor param and `private val coroutineScope = CoroutineScope(ioDispatcher)` field init
  with `@ApplicationScope private val coroutineScope: CoroutineScope`. Removed unused
  `Dispatcher`/`TrailsDispatchers`/`CoroutineDispatcher` imports.
- **MODIFIED** `services/firestore/FirestoreSyncManager.kt` — added `@ApplicationScope private val scope: CoroutineScope`
  constructor param; removed `private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)`;
  removed `SupervisorJob` and `cancel` imports; neutered `cleanup()` (no-op comment replaces `scope.cancel()`).
- **NEW** `test/…/common/di/AppScopeIsolationTest.kt` — two tests: child-failure isolation + post-failure launch acceptance.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/common/di/AppScopeModule.kt` — CREATED; qualifier + Hilt provider
- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — inject scope, remove bare init, remove unused imports
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` — inject scope, remove ad-hoc init, neuter cleanup()
- `android/app/src/test/java/com/jayteealao/trails/common/di/AppScopeIsolationTest.kt` — CREATED; isolation tests

## Shared Files (also touched by sibling slices)

- `FirestoreSyncManager.kt` — `batched-tag-reads` added `applyRemoteArticles` to this file (body only); this slice changes only the constructor and `cleanup()`. No conflict.
- `ArticleRepository.kt` — `fts-search-fix` edited `searchWithScore` method body only; this slice changes only the constructor params and imports. No conflict.

## Notes on Design Choices

- **Dispatcher reuse**: `AppScopeModule` injects `@Dispatcher(TrailsDispatchers.IO)` as the scope's dispatcher, exactly as `DispatchersModule` already provides it. No new dispatcher binding needed.
- **`Dispatchers.IO` import kept in `FirestoreSyncManager`**: `applyRemoteArticles` still calls `withContext(Dispatchers.IO)` — the import is not unused and was not removed.
- **Plan step 5 (`DataModule` verification)**: Confirmed `DataModule` uses `@Binds` with no explicit constructor listing — Hilt resolves the new `@ApplicationScope` param automatically. No edit needed.
- **Two tests instead of one**: Added a second test (`scope accepts new launches after child throws`) to cover the post-failure-launch acceptance scenario, which the plan described in Step 6 bullet 5 ("Assert scope is NOT cancelled"). The additional test makes the intent unambiguous with zero overhead.

## Verification Seams Built

- **A4 isolation** → `AppScopeIsolationTest` at `android/app/src/test/java/com/jayteealao/trails/common/di/AppScopeIsolationTest.kt` (enables `./gradlew :app:testDebugUnitTest` to drive the acceptance criterion directly, no Firebase/WorkManager needed)

## Visual Contract Honored

N/A — no `02c-craft.md` present.

## Deviations from Plan

None. All 8 plan steps executed as written. Plan step 5 was a verification-only step (no code edit); confirmed.

## Anything Deferred

None. All scope of this slice delivered in this pass.

## Known Risks / Caveats

- **`FirestoreSyncManager.cleanup()` no longer cancels the shared scope** — intentional, but callers that previously expected `cleanup()` to stop all in-flight sync work will no longer get that guarantee. The periodic WorkManager sync is still cancelled via `cancelPeriodicSync()`. Any in-flight `suspend` function launched by the WorkManager worker has its own coroutine context (the worker's scope) and is unaffected.
- **`ioDispatcher` is used as the shared scope's dispatcher** — this means background coroutines compete on the IO thread pool. If a future slice needs a dedicated background thread, a separate `@Provides` or `CoroutineContext` override should be introduced rather than modifying this scope.

## Freshness Research

No external API freshness check required. The `@Qualifier` + `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() + dispatcher)` pattern is stable Hilt idiom (Android Architecture Hilt guidance, Manuel Vivo). No library version changes affect this slice.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app app-scope` — run `AppScopeIsolationTest` via `./gradlew :app:testDebugUnitTest` to confirm A4 acceptance criterion is met.
- **Option B:** `/wf implement simplify-android-app firestore-dedup` — `firestore-dedup` is the next dependent slice that consumes the scope established here.
