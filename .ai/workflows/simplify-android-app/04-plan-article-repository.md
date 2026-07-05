---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: article-repository
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 3
metric-step-count: 7
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, repository, di, efficiency]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-article-repository.md
  siblings:
    - 03-slice-app-scope.md
    - 03-slice-fts-search-fix.md
    - 03-slice-list-viewmodel.md
  implement: 05-implement-article-repository.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app article-repository"
---

# Plan: ArticleRepository cleanup (quality-2 + efficiency-10 / B3)

## Current State

`ArticleRepositoryImpl` has two findings:

**quality-2 — raw `getInstance()` calls in `delete()`** (lines 243–244 of `ArticleRepository.kt`):
```kotlin
val user = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser
if (user != null) {
    com.google.firebase.firestore.FirebaseFirestore.getInstance()
        .collection("users")
        ...
```
Both `FirebaseFirestore` and `FirebaseAuth` already have `@Singleton` Hilt providers:
- `FirebaseFirestore` — `android/app/src/main/java/com/jayteealao/trails/services/firestore/di/FirestoreModule.kt` provides `@Singleton fun provideFirebaseFirestore(): FirebaseFirestore`
- `FirebaseAuth` — `android/app/src/main/java/com/jayteealao/trails/di/FirebaseModule.kt` provides `@Singleton fun provideFirebaseAuth(): FirebaseAuth`

Neither is currently injected into `ArticleRepositoryImpl`. The raw `getInstance()` calls bypass the DI graph, are untestable, and couple `delete()` to static Firebase initialisation.

**efficiency-10 — per-item `upsertArticle` loop in `add()`** (lines 167–183):
```kotlin
override suspend fun add(articleData: List<ArticleData>) {
    articleData.forEach { datum ->
        val articleToAdd = datum.article.copy(...)
        articleDao.upsertArticle(articleToAdd)          // N individual DB writes
        articleDao.insertArticleImages(datum.images)
        ...
    }
    ...
}
```
`ArticleDao` already has `@Upsert suspend fun upsertArticles(items: List<Article>)` (line 240 of `ArticleDao.kt`). The current per-item `upsertArticle` can be replaced with a single `upsertArticles(List)` call — Room 2.8 `@Upsert(List)` is auto-transactional. The five associated insert calls (`insertArticleImages`, `insertArticleVideos`, `insertArticleTags`, `insertArticleAuthors`, `insertDomainMetadata`) are already list-based and remain per-datum; only the `Article` upsert is batched.

**Post-app-scope constructor shape** (the shape this slice inherits after A4 lands):
```kotlin
class ArticleRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val articleDao: ArticleDao,
    private val syncStatusMonitor: SyncStatusMonitor,
    private val firestoreSyncManager: FirestoreSyncManager,
    @ApplicationScope private val coroutineScope: CoroutineScope   // <-- added by app-scope
    // ioDispatcher REMOVED by app-scope
)
```
B3 extends this constructor with two new params.

**`DataModule`** uses `@Binds` — no manual `@Provides` lists the constructor shape, so adding new params is automatically resolved by Hilt.

## Reuse Opportunities

- **`FirestoreModule.provideFirebaseFirestore()`** and **`FirebaseModule.provideFirebaseAuth()`** are already `@Singleton` providers installed in `SingletonComponent`. No new Hilt modules needed — only inject the existing bindings.
- **`articleDao.upsertArticles(List<Article>)`** already exists in `ArticleDao` (`@Upsert` line 240). No new DAO method needed.
- **Room 2.8 `@Upsert(List)`** is auto-transactional (from `02-shape.md` Freshness Research): using the existing `upsertArticles` method eliminates the N individual writes at no schema cost.
- **MockK patterns** established in `FirestoreBackupServiceTest` and `ArticleListViewModelTest` — reuse `@MockK`, `MockKAnnotations.init(this)`, `coVerify` exactly, `StandardTestDispatcher + runTest`.

## Likely Files / Areas to Touch

| File | Status | Role | Change |
|---|---|---|---|
| `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` | Modified | impl | Inject Firebase deps, patch `delete()`, batch `add()` |
| `android/app/src/test/java/com/jayteealao/trails/data/DefaultArticleRepositoryTest.kt` | Modified | test | Revive + extend with injection and bulk-insert assertions |
| `android/app/src/main/java/com/jayteealao/trails/data/di/DataModule.kt` | Modified (verify only) | binding | No source edit; verify Hilt resolves new params automatically |

## Proposed Change Strategy

Single hard-cutover pass, two independent changes in one slice:

1. **Constructor extension** — add `FirebaseFirestore` and `FirebaseAuth` as injected params to `ArticleRepositoryImpl`. Delete the two `getInstance()` calls in `delete()` and replace with the injected handles. Remove the fully-qualified class-name call sites; add proper imports at the top of the file.
2. **Bulk upsert in `add()`** — hoist the `articleToAdd` transform out of the `forEach` into a `map { }`, collect as `List<Article>`, call `articleDao.upsertArticles(articlesToAdd)` once after the map. Leave the associated-data inserts (`images`, `videos`, `tags`, `authors`, `domainMetadata`) in a second `forEach` over the original list (they are already list-based). The Firestore sync trigger at the end of `add()` is unchanged.
3. **Tests** — extend `DefaultArticleRepositoryTest` with two new test methods; the existing stub test stays green.

No new Hilt modules. No DAO schema changes. `DataModule` requires no edit.

## Step-by-Step Plan

**Step 1 — Read and confirm post-app-scope constructor shape**
Confirm `ioDispatcher` has been removed and `@ApplicationScope coroutineScope` has been added (by app-scope slice). If app-scope has not landed, stop and wait. No file edits in this step.

**Step 2 — Extend `ArticleRepositoryImpl` constructor with Firebase params**
In `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt`:

Add two new constructor params after the existing params (after `@ApplicationScope coroutineScope`):
```kotlin
private val firestore: FirebaseFirestore,
private val firebaseAuth: FirebaseAuth,
```

Add imports at the top:
```kotlin
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
```

**Step 3 — Patch `delete()` to use injected handles**
Replace the raw `getInstance()` block in `delete()`:
```kotlin
// BEFORE
val user = com.google.firebase.auth.FirebaseAuth.getInstance().currentUser
if (user != null) {
    com.google.firebase.firestore.FirebaseFirestore.getInstance()
        .collection("users")

// AFTER
val user = firebaseAuth.currentUser
if (user != null) {
    firestore.collection("users")
```
The `SetOptions.merge()` import — `com.google.firebase.firestore.SetOptions` — is already used inline; ensure it is imported once at the top after the refactor.

**Step 4 — Batch article upserts in `add()`**
Replace the single-`forEach` in `add()` with two passes:
```kotlin
override suspend fun add(articleData: List<ArticleData>) {
    // Pass 1: transform all articles, then bulk-upsert
    val articlesToAdd = articleData.map { datum ->
        datum.article.copy(
            normalizedUrl = normalizeUrl(datum.article.url ?: datum.article.givenUrl ?: ""),
            deletedAt = null,
            archivedAt = null,
            timeUpdated = System.currentTimeMillis()
        )
    }
    articleDao.upsertArticles(articlesToAdd)

    // Pass 2: per-datum associated data (already List-based, no change)
    articleData.forEach { datum ->
        articleDao.insertArticleImages(datum.images)
        datum.videos.let { articleDao.insertArticleVideos(it) }
        articleDao.insertArticleTags(datum.tags)
        articleDao.insertArticleAuthors(datum.authors)
        datum.domainMetadata?.let { articleDao.insertDomainMetadata(it) }
    }

    // Firestore sync trigger (unchanged)
    coroutineScope.launch {
        try {
            firestoreSyncManager.syncLocalChanges()
        } catch (e: Exception) {
            Timber.e(e, "Failed to sync newly added articles")
        }
    }
}
```

**Step 5 — Verify `DataModule` needs no change**
`DataModule` uses `@Binds` on `ArticleRepositoryImpl`. Hilt infers constructor params from `@Inject`. The new `FirebaseFirestore` and `FirebaseAuth` params are automatically resolved from `FirestoreModule` and `FirebaseModule`. Confirm by inspecting the file (already done — no `@Provides` lists the constructor shape explicitly).

**Step 6 — Extend `DefaultArticleRepositoryTest`**
In `android/app/src/test/java/com/jayteealao/trails/data/DefaultArticleRepositoryTest.kt`:

Add MockK fields and setUp:
```kotlin
@MockK private lateinit var articleDao: ArticleDao
@MockK private lateinit var syncStatusMonitor: SyncStatusMonitor
@MockK private lateinit var firestoreSyncManager: FirestoreSyncManager
@MockK private lateinit var firestore: FirebaseFirestore
@MockK private lateinit var firebaseAuth: FirebaseAuth
private val testDispatcher = StandardTestDispatcher()
private lateinit var repository: ArticleRepositoryImpl

@Before
fun setUp() {
    MockKAnnotations.init(this, relaxed = true)
    repository = ArticleRepositoryImpl(
        context = mockk(relaxed = true),
        articleDao = articleDao,
        syncStatusMonitor = syncStatusMonitor,
        firestoreSyncManager = firestoreSyncManager,
        coroutineScope = CoroutineScope(SupervisorJob() + testDispatcher),
        firestore = firestore,
        firebaseAuth = firebaseAuth
    )
}
```

Add test 1 — delete() uses injected Firebase handles:
```kotlin
@Test
fun `delete uses injected FirebaseAuth and FirebaseFirestore`() = runTest(testDispatcher) {
    val mockUser = mockk<FirebaseUser> { every { uid } returns "uid1" }
    every { firebaseAuth.currentUser } returns mockUser
    // mock firestore chain to return a Task<Void>
    val mockCollection: CollectionReference = mockk(relaxed = true)
    val mockDocument: DocumentReference = mockk(relaxed = true)
    every { firestore.collection("users") } returns mockCollection
    every { mockCollection.document("uid1") } returns mockDocument
    every { mockDocument.collection("articles") } returns mockCollection
    every { mockCollection.document("item1") } returns mockDocument
    every { mockDocument.set(any(), any<SetOptions>()) } returns Tasks.forResult(null)
    coEvery { articleDao.updateDeleted(any(), any()) } returns Unit

    repository.delete("item1")
    advanceUntilIdle()

    verify { firebaseAuth.currentUser }
    verify { firestore.collection("users") }
    // confirm getInstance() was NOT called (no static mock registered → would throw)
}
```

Add test 2 — add() calls upsertArticles once:
```kotlin
@Test
fun `add performs single bulk article upsert`() = runTest(testDispatcher) {
    val articles = (1..3).map { i ->
        ArticleData(
            article = Article(itemId = "id$i", articleId = "aid$i", ...minimal fields...),
            images = emptyList(), videos = emptyList(), tags = emptyList(),
            authors = emptyList(), domainMetadata = null
        )
    }
    coEvery { articleDao.upsertArticles(any()) } returns Unit
    coEvery { firestoreSyncManager.syncLocalChanges() } returns Unit

    repository.add(articles)
    advanceUntilIdle()

    coVerify(exactly = 1) { articleDao.upsertArticles(any()) }
    coVerify(exactly = 0) { articleDao.upsertArticle(any()) }
}
```

**Step 7 — Run verification**
```
./gradlew :app:testDebugUnitTest
```
Expected: existing stub test passes; new delete and add tests pass; no regressions in `FtsSearchTest` or `AppScopeIsolationTest`.

## Test / Verification Plan

**Automated (only — no interactive verification needed for this slice):**

| Test | File | Gradle task |
|---|---|---|
| `delete uses injected FirebaseAuth and FirebaseFirestore` | `test/.../data/DefaultArticleRepositoryTest.kt` | `./gradlew :app:testDebugUnitTest` |
| `add performs single bulk article upsert` | `test/.../data/DefaultArticleRepositoryTest.kt` | `./gradlew :app:testDebugUnitTest` |
| Existing stub `pockets_newItemSaved_itemIsReturned` (stays green) | same file | same task |

The test for `delete()` verifies that `firebaseAuth.currentUser` and `firestore.collection(...)` are called on the injected mocks. Because no `mockkStatic(FirebaseAuth::class)` is registered, any call to the raw `FirebaseAuth.getInstance()` would throw an unmocked-static exception — serving as a negative assertion that the raw call is gone.

The test for `add()` uses `coVerify(exactly = 1)` on `upsertArticles` and `coVerify(exactly = 0)` on `upsertArticle` to confirm the single-call bulk path without also asserting on the associated-data inserts (which remain per-datum and are intentionally `relaxed`).

## Risks / Watchouts

**HIGH — Constructor is shared with app-scope; must sequence B3 strictly after A4**
`ArticleRepositoryImpl` constructor is modified by app-scope (A4) to add `@ApplicationScope coroutineScope` and remove `ioDispatcher`. This slice extends the post-app-scope constructor. Landing B3 before A4 causes a three-way merge conflict. Enforce: app-scope merged → article-repository begins.

**MED — Bulk upsert must preserve upsert-by-URL semantics**
The current `add()` calls `articleDao.upsertArticle(articleToAdd)` — this is a primary-key `@Upsert`, not a URL-dedup path. `upsertNewArticle()` (the URL-dedup method) is NOT called in `add()`. Replacing N `upsertArticle` calls with one `upsertArticles(List)` preserves semantics exactly: both use `@Upsert` with Room's default primary-key conflict resolution. Do NOT route through `upsertNewArticle` — that would change conflict semantics.

**LOW — `searchWithScore` is owned by fts-search-fix — must not touch it**
`ArticleRepository.kt` also contains `searchWithScore`. B3 edits only the constructor, `delete()`, and `add()`. Sequence `fts-search-fix` (A1) before B3 to reduce merge churn; B3 patches the already-fixed file cleanly.

**LOW — Associated inserts stay per-datum**
`insertArticleImages`, `insertArticleVideos`, `insertArticleTags`, `insertArticleAuthors`, `insertDomainMetadata` are already `List<T>` — they are not N+1 per field. They stay inside a second `forEach` because each `ArticleData` carries its own associated set. Flat-mapping them would conflate ownership and is out of scope.

## Dependencies on Other Slices

| Slice | Direction | Dependency |
|---|---|---|
| `app-scope` (A4) | prerequisite | Edits `ArticleRepositoryImpl` constructor first; B3 inherits the post-A4 shape. Hard dependency — do not start B3 until A4 is merged. |
| `test-net` (E1) | prerequisite | Provides the revived `DefaultArticleRepositoryTest` compile environment. B3 extends its test body. |
| `fts-search-fix` (A1) | soft predecessor | Both touch `ArticleRepository.kt` (different methods). Sequence A1 before B3 to minimize merge churn. |
| `list-viewmodel` (B5) | dependent | B5 moves DAO calls behind the repository surface; it depends on B3's stable repo surface (no further constructor changes after B3). |

## Assumptions

1. `app-scope` has landed and `ArticleRepositoryImpl` constructor no longer contains `ioDispatcher`; it contains `@ApplicationScope coroutineScope`. (Must be verified before Step 2.)
2. `articleDao.upsertArticle(Article)` and `articleDao.upsertArticles(List<Article>)` are both `@Upsert` — same conflict strategy, only call count differs. (Confirmed by reading `ArticleDao.kt` lines 237–240.)
3. `add()` does NOT call `upsertNewArticle()` — the URL-dedup logic. (Confirmed: current `add()` calls plain `upsertArticle`.) Bulk switch is safe.
4. `FirebaseFirestore` and `FirebaseAuth` are already `@Singleton` providers in `SingletonComponent`. No new DI module needed. (Confirmed: `FirestoreModule.kt` and `FirebaseModule.kt` exist with `@Provides @Singleton`.)
5. `DataModule` uses `@Binds` and will auto-resolve the two new constructor params without any source edit. (Confirmed by reading `DataModule.kt`.)
6. `MockK 1.14.5` + `kotlinx-coroutines-test` are on the unit-test classpath (from `test-net` plan). No new test dependencies needed.
7. `Tasks.forResult(null)` from `com.google.android.gms.tasks.Tasks` is available in unit tests (confirmed established pattern in `FirestoreBackupServiceTest`).

## Blockers

None. All information required to implement is available from static analysis. Soft predecessor: `app-scope` and `test-net` must be implemented before B3 begins implementation.

## Freshness Research

From `02-shape.md` § Freshness Research (Room 2.8):

> **Room 2.8.0 (efficiency-3/10)** — `@Insert(List)`/`@Delete(List)` are auto-transactional; use `@Transaction`/`withTransaction {}` only for multi-op atomicity; `DELETE … WHERE parentId` for cascade deletes. KSP (not kapt) on Kotlin 2.x. Source: Room docs.

`@Upsert(List)` follows the same auto-transactional guarantee as `@Insert(List)`. The existing `upsertArticles(items: List<Article>)` in `ArticleDao` is correctly annotated `@Upsert` and does not need an additional `@Transaction` wrapper for the single-method call. The combined two-pass approach in `add()` (articles bulk-upserted first, then associated-data inserts per-datum) is NOT within a single `@Transaction` — this is intentional: the current code also has no wrapping transaction, and adding one would be out of scope and could introduce lock contention.

No additional web search required. Firebase `getInstance()` vs injection is a standard DI pattern with no version-specific risk. The existing `FirestoreModule` and `FirebaseModule` providers cover the injected bindings completely.

## Revision History

_(none — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app article-repository`

Prerequisites: `test-net` and `app-scope` and `fts-search-fix` slices must be implemented and merged first. Once those are green, this slice can proceed directly with the constructor extension, `delete()` patch, `add()` bulk-upsert, and test additions described above.
