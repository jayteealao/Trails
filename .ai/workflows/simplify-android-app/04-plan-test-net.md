---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: test-net
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 10
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [test-infra, characterization, android]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-test-net.md
  siblings:
    - 03-slice-firestore-dedup.md
    - 03-slice-firestore-io.md
    - 03-slice-fts-search-fix.md
    - 03-slice-streaming-restore.md
  implement: 05-implement-test-net.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app test-net"
---

# Plan: Regression net — revive test infra + Firestore characterization

## Current State

Two test infra files are entirely commented out / empty:

**`TestDatabaseModule.kt`** (androidTest): The entire `@Module @TestInstallIn` body is commented
out, referencing a deleted `FakePocketRepository` and `DataModule` binding that no longer match
the current `ArticleRepositoryImpl` constructor (which now requires `SyncStatusMonitor`,
`FirestoreSyncManager`, and an `ioDispatcher`). The file is structurally correct (correct package,
no compile errors) but provides zero test infrastructure.

**`DefaultArticleRepositoryTest.kt`** (unit test): The single test `pockets_newItemSaved_itemIsReturned`
has its entire body commented out, plus the inner `FakePocketDao` class. The test compiles and runs
but asserts nothing — it is a green stub. The `FakePocketDao` interface contract has drifted
from the current `ArticleDao` interface (dozens of new methods added since).

**`FirestoreBackupServiceTest.kt`** (unit test): Already active and green (8 tests covering
`backupArticle` marker writes, `writeArticleMarker`, `backupArticles`). Needs extension with
characterization tests for batch-chunking and large-text paths.

**`FirestoreSyncManagerTest.kt`** (unit test): Does not exist. All `FirestoreSyncManager`
behaviour — auth-guard, tag-backup N+1 loop, adaptive chunk size, sync-strategy selection,
conflict resolution — is uncovered.

**Why disabled**: `TestDatabaseModule` was disabled when `FakePocketRepository`/`DataModule` were
deleted in a Hilt restructure; nobody updated the test module. `DefaultArticleRepositoryTest` was
disabled at the same time because the fake DAO became stale. Neither was ever updated to track the
evolved constructor. The Hilt graph for instrumented tests therefore has no working DI replacement
for `DataModule` — instrumented tests relying on `ArticleRepository` cannot compile a valid Hilt
component.

## Reuse Opportunities

- **`FirestoreBackupServiceTest.kt`** — reuse the existing `setUp()` mock chain (`firestore`,
  `auth`, `batch`, `markersCollection`, `usersCollection`, `userDoc`, `articlesCollection`).
  The characterization tests for `backupArticlesPaginated` and large-text extend this fixture.
  Modify in place; do not create a new test file.
- **MockK patterns** — `@MockK`, `MockKAnnotations.init(this)`, `clearAllMocks()` are established
  across `FirestoreBackupServiceTest`, `ArticleListViewModelTest`, `ArchiveServiceTest`. Follow
  the same `@Before`/`@After` pattern.
- **`StandardTestDispatcher` + `runTest`** — established in `ArticleListViewModelTest`. Use the
  same coroutines-test idiom for `FirestoreSyncManagerTest`.
- **`Tasks.forResult(null)` / `Tasks.forException(...)`** — already in `FirestoreBackupServiceTest`
  for mocking `Task<Void>` returns. Reuse for `FirestoreSyncManager` mock stubs.
- **`HiltTestRunner`** — already registered in `build.gradle.kts`
  (`testInstrumentationRunner = "com.jayteealao.trails.HiltTestRunner"`); no change needed.
- `hilt-android-testing` is already declared as both `androidTestImplementation` and
  `testImplementation`; `hilt-android-compiler` is declared as both `kaptAndroidTest` and
  `kaptTest`. No new dependencies needed.

## Likely Files / Areas to Touch

| File | Status | Change |
|------|--------|--------|
| `src/androidTest/.../testdi/TestDatabaseModule.kt` | Modified | Revive `@TestInstallIn` with in-memory Room or MockK repository binding |
| `src/test/.../data/DefaultArticleRepositoryTest.kt` | Modified | Revive the one test with a MockK-based `ArticleDao` fake |
| `src/test/.../services/firestore/FirestoreBackupServiceTest.kt` | Modified | Add characterization tests for batch chunking + large-text paths |
| `src/test/.../services/firestore/FirestoreSyncManagerTest.kt` | New | Characterization tests for auth-guard, tag-backup loop, adaptive chunks, sync strategy |

**Production code: zero changes.** This slice is test-only.

## Proposed Change Strategy

1. **Revive `DefaultArticleRepositoryTest`** first: it is the simplest change and validates the
   MockK setup. Wire `ArticleRepositoryImpl` with `MockK` fakes for `ArticleDao`,
   `SyncStatusMonitor`, `FirestoreSyncManager`, and `Dispatchers.IO`; verify the `pockets()`
   call delegates to `articleDao.getArticlesWithTags()`.

2. **Revive `TestDatabaseModule`**: uncomment, update the `@TestInstallIn` to provide an
   in-memory `AppDatabase` (via `Room.inMemoryDatabaseBuilder`) and bind `ArticleRepositoryImpl`
   with MockK or constructor injection for the external deps (`FirestoreSyncManager`,
   `SyncStatusMonitor`). Scope: only provide what the instrumentated tests need; do not try to
   fully wire Firestore or WorkManager in the instrumented graph.

3. **Extend `FirestoreBackupServiceTest`** with characterization tests for the surfaces
   `firestore-dedup` and `streaming-restore` will refactor: `backupArticlesPaginated` batch
   chunking (WRITE_BATCH_LIMIT=20), large-text inline vs subcollection branching, and
   `restoreAllArticlesPaginated` accumulating all pages in-memory.

4. **Write `FirestoreSyncManagerTest`** covering: auth-guard on all public suspend fns,
   tag-backup N+1 per-article batch (the current quirk), adaptive chunk size selection,
   `performFullSync` scenario dispatch, `handleRemoteArticleChange` new-article and update-article
   paths, `shouldAcceptRemoteChange` timestamp comparison, and `performBidirectionalSync` ordering.

Pin behaviour AS-IS including quirks; do not "fix" anything here.

## Step-by-Step Plan

1. **Read `ArticleRepositoryImpl` constructor** (already done) — confirm all deps needed for
   MockK setup: `Context`, `ArticleDao`, `SyncStatusMonitor`, `FirestoreSyncManager`,
   `CoroutineDispatcher`.

2. **Revive `DefaultArticleRepositoryTest`**: uncomment the test body; replace `FakePocketDao`
   with `@MockK private lateinit var articleDao: ArticleDao`; add `@MockK` for
   `SyncStatusMonitor`, `FirestoreSyncManager`; use `StandardTestDispatcher` for the dispatcher;
   stub `articleDao.getArticlesWithTags()` to return a `TestPagingSource`; call
   `repository.pockets()` and assert the result is non-null. Keep scope minimal — one passing test.

3. **Revive `TestDatabaseModule`**: replace commented body with:
   - `@Module @TestInstallIn(components=[SingletonComponent::class], replaces=[DataModule::class])`
   - Provide `AppDatabase` via `Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()`
   - Provide `ArticleDao` from the in-memory DB
   - Mock or provide `SyncStatusMonitor`, `FirestoreSyncManager` (mock objects) so
     `ArticleRepositoryImpl` can be constructed; bind it as `ArticleRepository`
   - Annotate with `@InstallIn(SingletonComponent::class)`

4. **Verify unit test suite compiles**: run `./gradlew :app:testDebugUnitTest` (dry-run check) —
   `DefaultArticleRepositoryTest` must pass.

5. **Extend `FirestoreBackupServiceTest` — batch characterization**:
   - `backupArticlesPaginated chunks at WRITE_BATCH_LIMIT`: create 45 mock articles; call
     `backupArticlesPaginated`; verify `firestore.batch()` called 3 times (ceil(45/20)=3) and
     `batch.commit()` called 3 times.
   - `backupArticlesPaginated large-text article`: article with `text` > 900KB (mock `toByteArray().size`); verify `batch.set` is called on the `text/content` subcollection ref AND `batch.set` on the article ref with `text=null`.
   - `backupArticlesPaginated inline-text article`: article with `text` < 900KB; verify `batch.set` on article ref with text intact; no subcollection set call.
   - `restoreAllArticlesPaginated accumulates all pages`: mock two pages of 50 articles each; verify return value contains 100 articles total (baseline for the OOM quirk; comment: "streaming-restore slice will replace this with per-page writes").

6. **Extend `FirestoreBackupServiceTest` — auth-guard characterization**:
   - `restoreAllArticlesPaginated returns failure when unauthenticated`: `every { auth.currentUser } returns null`; assert `Result.isFailure` and message == "User not authenticated".
   - `getLastSyncTimestamp reads users-uid document`: verify `firestore.collection("users").document("u1").get()` is called and `getLong("lastSyncTimestamp")` is read.
   - `isFirstSync returns true when lastSyncTimestamp absent`: mock doc with `contains("lastSyncTimestamp") = false`; assert `Result.success(true)`.

7. **Write `FirestoreSyncManagerTest`** — auth-guard:
   - `syncLocalChanges emits SyncStatus Error and returns when user is null`: mock `auth.currentUser = null`; call `syncLocalChanges()`; collect `syncStatus` value; assert `SyncStatus.Error("Not authenticated", null)`.
   - `performFullSync emits SyncStatus Error and returns when user is null`: same pattern.

8. **Write `FirestoreSyncManagerTest`** — tag-backup N+1 characterization:
   - Set up a chunk of 2 articles, each with 2 tags; mock `articleDao.getArticleTags(id)` to return the tags; mock `firestoreBackupService.backupArticlesPaginated` to succeed; mock `auth.currentUser` valid.
   - Call `syncLocalChanges()` (first-sync=false, lastSync=0, countAll=2, paginated returns the 2 articles).
   - Verify `firestore.batch()` called TWICE (once per article in tag-backup loop) — this is the N+1 quirk. Comment: "firestore-dedup will collapse to one batch per chunk."

9. **Write `FirestoreSyncManagerTest`** — sync-strategy and conflict resolution:
   - `performFullSync first-sync restore scenario`: localCount=0, remoteCount=5 → verify `firestoreBackupService.restoreAllArticlesPaginated` called, then `updateLastSyncTimestamp`.
   - `shouldAcceptRemoteChange remote newer returns true`: create local (timeUpdated=100) and remote (timeUpdated=200); call via reflection or expose via package-private test. Alternatively, test via `handleRemoteArticleChange` — remote.timeUpdated > local → `articleDao.upsertArticle` called with remoteArticle.
   - `shouldAcceptRemoteChange timestamps equal uses completeness score`: local has text, remote has no text → local score higher → verify `pushLocalArticle` called (not upsert).

10. **Run full unit test task**: `./gradlew :app:testDebugUnitTest` — all tests in the new/revived files must pass. Note `FirestoreSyncManager.schedulePeriodicSync()` / `cancelPeriodicSync()` are excluded (WorkManager requires instrumented context); document as out of scope.

## Test / Verification Plan

### Automated checks

- **Task**: `./gradlew :app:testDebugUnitTest`
  - `DefaultArticleRepositoryTest` — 1 test, must pass
  - `FirestoreBackupServiceTest` — existing 8 + ~7 new characterization tests, all green
  - `FirestoreSyncManagerTest` — ~10 new characterization tests, all green

- **Task**: `./gradlew :app:connectedDebugAndroidTest` (requires connected device/emulator)
  - `TestDatabaseModule` revival is validated when instrumented tests that depend on
    `ArticleRepository` injection can compile and run (the `PocketScreenTest` and `NavigationTest`
    that are partially commented out are not revived in this slice; only the module compiles).

The slice is complete when `./gradlew :app:testDebugUnitTest` passes with zero failures and the
new `FirestoreSyncManagerTest` file is present.

### Interactive verification

None required. This slice is test-only with no production change. Manual verification is not applicable.

## Risks / Watchouts

1. **TestDatabaseModule revival may surface a larger Hilt graph break** (med): The original module
   was disabled before `ArticleRepositoryImpl` grew multiple constructor deps. If Hilt singleton
   scoping conflicts with the test component, the fix may balloon. Mitigation: prefer MockK
   constructor injection for `SyncStatusMonitor` and `FirestoreSyncManager` over a full Hilt
   in-memory graph; if revival exceeds ~2h, descope `TestDatabaseModule` to a plain unit test
   harness and record a deferral with reason.

2. **FirestoreSyncManager is hard to unit-test: ad-hoc CoroutineScope + WorkManager** (med):
   `FirestoreSyncManager` creates `CoroutineScope(SupervisorJob() + Dispatchers.IO)` internally
   and calls `WorkManager.getInstance(context)`. These make scheduling non-deterministic in plain
   JUnit. Mitigation: mock `WorkManager` at object level with MockK
   (`mockkStatic(WorkManager::class)`); use `StandardTestDispatcher` via test-only constructor
   overload or reflective field injection. Pin only the public `suspend` functions;
   `schedulePeriodicSync`/`cancelPeriodicSync` are out of scope for this slice.

3. **Characterization tests must pin current quirks, not fix them** (low): The tag-backup N+1
   per-article batch and `restoreAllArticlesPaginated` in-memory accumulation are the exact
   behaviour `firestore-dedup` and `streaming-restore` will refactor. If tests are written
   against the ideal post-refactor behaviour they will fail on the current code (defeating their
   purpose). Mitigation: assert the as-is batch count; include inline comments marking which
   assertions are expected to change.

## Dependencies on Other Slices

- **None** — `test-net` is the foundational gate. All other slices depend on it; it depends on
  nothing.
- `firestore-dedup` and `firestore-io` depend on the `FirestoreSyncManagerTest` characterization
  suite being green before they land.
- `fts-search-fix` and `streaming-restore` also gate on `test-net` being complete and green.

## Assumptions

- The existing `hilt-android-testing` (both `testImplementation` and `androidTestImplementation`)
  and MockK (`testImplementation("io.mockk:mockk:1.14.5")`) dependencies are already declared in
  `build.gradle.kts` — no version catalog changes needed.
- `kotlinx-coroutines-play-services:1.10.2` is already declared in `testImplementation` for
  `Task.await()` support in unit tests.
- `isReturnDefaultValues = true` is set in `testOptions.unitTests` — Firebase enum static
  initializers do not throw "not mocked" in unit tests.
- `WorkManager` can be mocked via `mockkStatic` without requiring a real `Context` in unit tests.
- `FirestoreSyncManager.scope` is not injected; characterization tests accept that coroutine
  execution must be driven with `advanceUntilIdle()` after replacing `Dispatchers.IO` via
  `Dispatchers.setMain`.

## Blockers

None.

## Freshness Research

From `02-shape.md` freshness section (no new web search required — confirmed applicable):

- **MockK 1.14.5 + coroutines-test 1.10.2**: already in the test classpath
  (`testImplementation` declarations confirmed in `build.gradle.kts`). `runTest` +
  `StandardTestDispatcher` + `advanceUntilIdle()` is the correct idiom for coroutine-heavy unit
  tests.
- **hilt-testing 2.57.1**: `@HiltAndroidTest` + `HiltAndroidRule` + `@TestInstallIn` pattern
  for replacing production modules in instrumented tests is stable on this version.
- **Room 2.8.0**: `Room.inMemoryDatabaseBuilder` is the correct approach for test databases;
  the `allowMainThreadQueries()` builder option is available for test scenarios.
- **Firebase task mocking**: `com.google.android.gms.tasks.Tasks.forResult(null)` and
  `Tasks.forException(...)` are the correct stubs for `Task<Void>` returns in unit tests
  (already established in `FirestoreBackupServiceTest`).

## Revision History

(none — initial plan)

## Recommended Next Stage

`/wf implement simplify-android-app test-net` — execute this plan in implementation order
(Steps 1–10 above). The slice is test-only; no production code changes. Once
`./gradlew :app:testDebugUnitTest` is green, the regression net is live and the dependent
slices (`fts-search-fix`, `streaming-restore`, `batched-tag-reads`, `firestore-dedup`,
`firestore-io`) may proceed.
