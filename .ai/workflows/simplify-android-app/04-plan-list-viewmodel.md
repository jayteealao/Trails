---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: list-viewmodel
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 8
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, viewmodel, repository-boundary, dead-code]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-list-viewmodel.md
  siblings:
    - 03-slice-article-repository.md
    - 03-slice-detail-viewmodel.md
  implement: 05-implement-list-viewmodel.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app list-viewmodel"
---

# Plan: ArticleListViewModel cleanup (quality-5 + quality-11 + quality-12 + reuse-6 / B5)

## Current State

`ArticleListViewModel` (screens/articleList/ArticleListViewModel.kt) has four findings:

**quality-5 — dead `_articles` MutableStateFlow** (line 139):
```kotlin
private var _articles = MutableStateFlow(emptyList<Article>())
```
This field is never read, never written after init, and has no collector. The `articles` StateFlow above it (line 140) uses the `Pager` / `getArticleWithTextUseCase()` path. The `_articles` field is pure dead weight.

**quality-12 — commented-out `sync()` body** (lines 132–137):
```kotlin
fun sync() {
    viewModelScope.launch(ioDispatcher) {
//        articleDao.clearModalTable()
//        synchronizePocketUseCase()
    }
}
```
The method body is 100% commented out. The method itself is empty and has no caller in the codebase. Delete the entire method.

**quality-11 broadened — direct `ArticleDao` calls in the ViewModel** (four sites across `insertArticle`, `saveUrl`, `regenerateArticleDetails`):
- `articleDao.upsertArticle(...)` — `insertArticle()`, line 263
- `articleDao.upsertNewArticle(...)` — `saveUrl()`, line 319
- `articleDao.getArticleById(...)` — `saveUrl()` undo-race guard, line 363
- `articleDao.updateUnfurledDetails(...)` — `saveUrl()`, line 369
- `articleDao.getArticleById(...)` — `regenerateArticleDetails()`, line 397
- `articleDao.updateUnfurledDetails(...)` — `regenerateArticleDetails()`, line 428

Six direct DAO call-sites across three methods. The ViewModel constructor takes `private val articleDao: ArticleDao` as a DI param. This creates a leaky abstraction: the ViewModel bypasses the repository boundary and couples directly to Room.

**reuse-6 — pass-through `GetArticleWithTextUseCase`** (line 65 constructor, lines 143–145 `articles` Pager):
```kotlin
private val getArticleWithTextUseCase: GetArticleWithTextUseCase
// ...
pagingSourceFactory = { getArticleWithTextUseCase() }
```
`GetArticleWithTextUseCase.invoke()` is a one-liner: `return pocketRepository.pockets()`. The ViewModel already holds `articleRepository` — there is zero reason for the indirection. The use case is deleted; the Pager calls `articleRepository.pockets()` directly.

**Repository surface check — what's missing:**
- `articleRepository.getArticleById(itemId)` — ALREADY EXISTS on `ArticleRepository` interface.
- `articleRepository.saveNewArticle(article)` — MISSING. Needed to wrap `articleDao.upsertNewArticle(article)`. Must be added (consistent with B3 style).
- `articleRepository.updateUnfurledDetails(...)` — MISSING. Needed to wrap `articleDao.updateUnfurledDetails(...)`. Must be added.
- `articleRepository.upsertArticle(article)` — MISSING. Needed to wrap `articleDao.upsertArticle(article)` used in `insertArticle()`. Must be added.

All three are thin delegation methods; no new logic. All consistent with B3's injection/delegation style.

## Reuse Opportunities

- **`articleRepository.pockets()`** already exists on the `ArticleRepository` interface with identical semantics to `GetArticleWithTextUseCase.invoke()` — confirmed by reading the use case source. Deletion is safe.
- **`articleRepository.getArticleById(itemId)`** already exists — no new method needed for this site.
- **MockK patterns** established in existing `ArticleListViewModelTest` and `DefaultArticleRepositoryTest` — reuse `@MockK`, `coEvery`, `coVerify exactly`, `StandardTestDispatcher + runTest`.
- **`ioDispatcher` stays** — the ViewModel still uses `viewModelScope.launch(ioDispatcher)` in six action methods (`sync` body deleted, but `insertArticle`, `saveUrl`, etc. still use it). Do NOT remove `ioDispatcher` from the constructor.

## Likely Files / Areas to Touch

| File | Status | Role | Delta |
|---|---|---|---|
| `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt` | Modified | Primary — ViewModel under cleanup | +5 / -30 |
| `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` | Modified | Add 3 new pass-through methods to interface + impl | +25 / -0 |
| `android/app/src/main/java/com/jayteealao/trails/usecases/GetArticleWithTextUseCase.kt` | **Deleted** | Use case eliminated (trivial pass-through) | +0 / -10 |
| `android/app/src/test/java/com/jayteealao/trails/screens/articleList/ArticleListViewModelTest.kt` | Modified | Update setUp + constructor call; remove DAO mock; add repo assertions | +25 / -10 |

## Proposed Change Strategy

Single hard-cutover pass, three coupled changes in one slice:

1. **Add pass-through repo methods** — extend `ArticleRepository` interface and `ArticleRepositoryImpl` with `saveNewArticle`, `updateUnfurledDetails`, `upsertArticle` (thin delegation to the corresponding DAO methods, preserving dispatcher semantics — no re-dispatch inside the impl, no added transaction wrappers).
2. **Rewrite ViewModel** — replace the six direct DAO call-sites with the three repo methods; replace `getArticleWithTextUseCase()` with `articleRepository.pockets()`; delete `_articles`; delete `sync()` method; remove `articleDao` and `getArticleWithTextUseCase` constructor params and their imports.
3. **Delete `GetArticleWithTextUseCase.kt`** — hard-delete the file (no callers remain after step 2).
4. **Update tests** — remove DAO-related mocks and use-case mock from `ArticleListViewModelTest`; add repo-level stubs for the three new methods; update ViewModel constructor call; add assertions that data access goes through the repo mock.

No new Hilt modules needed — `GetArticleWithTextUseCase` is `@Inject constructor`-bound (no explicit `@Provides`); deleting the class removes its Hilt binding. The `articleDao` binding in `DataModule` is unaffected.

## Step-by-Step Plan

**Step 1 — Confirm B3 (article-repository) has landed**
Verify `ArticleRepositoryImpl` constructor has the post-B3 shape (`FirebaseFirestore`, `FirebaseAuth` injected; `getInstance()` calls gone from `delete()`). If B3 is not merged, stop. No file edits in this step.

**Step 2 — Add three new methods to `ArticleRepository` interface**
In `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt`, add to the interface:
```kotlin
suspend fun saveNewArticle(article: Article): String
suspend fun upsertArticle(article: Article)
suspend fun updateUnfurledDetails(
    itemId: String, title: String, url: String,
    image: String?, hasImage: Boolean, excerpt: String, normalizedUrl: String
)
```
Note: `getArticleById` is already on the interface — no change needed there.

**Step 3 — Add delegating implementations to `ArticleRepositoryImpl`**
In the same file, add to `ArticleRepositoryImpl`:
```kotlin
override suspend fun saveNewArticle(article: Article): String =
    articleDao.upsertNewArticle(article)

override suspend fun upsertArticle(article: Article) =
    articleDao.upsertArticle(article)

override suspend fun updateUnfurledDetails(
    itemId: String, title: String, url: String,
    image: String?, hasImage: Boolean, excerpt: String, normalizedUrl: String
) = articleDao.updateUnfurledDetails(itemId, title, url, image, hasImage, excerpt, normalizedUrl)
```
No dispatcher re-wrapping. No new `@Transaction` annotation (the DAO's `upsertNewArticle` already carries `@Transaction`; the delegation preserves that at the Room layer).

**Step 4 — Rewrite `ArticleListViewModel` constructor and DAO-call sites**
In `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListViewModel.kt`:

4a. Remove from constructor: `private val getArticleWithTextUseCase: GetArticleWithTextUseCase` and `private val articleDao: ArticleDao`. Keep `articleRepository`, `ioDispatcher`.

4b. Delete line 139: `private var _articles = MutableStateFlow(emptyList<Article>())`

4c. Delete the entire `sync()` method (lines 132–137).

4d. In the `articles` Pager (line 144), replace `getArticleWithTextUseCase()` with `articleRepository.pockets()`.

4e. In `insertArticle()` (line 263), replace:
```kotlin
articleDao.upsertArticle(article.copy(normalizedUrl = normalizeUrl(article.url ?: article.givenUrl ?: "")))
```
with:
```kotlin
articleRepository.upsertArticle(article.copy(normalizedUrl = normalizeUrl(article.url ?: article.givenUrl ?: "")))
```

4f. In `saveUrl()`, replace three DAO calls:
- `articleDao.upsertNewArticle(Article(...))` → `articleRepository.saveNewArticle(Article(...))`
- `articleDao.getArticleById(articleId)` → `articleRepository.getArticleById(articleId)`
- `articleDao.updateUnfurledDetails(...)` → `articleRepository.updateUnfurledDetails(...)`

4g. In `regenerateArticleDetails()`, replace two DAO calls:
- `articleDao.getArticleById(itemId)` → `articleRepository.getArticleById(itemId)`
- `articleDao.updateUnfurledDetails(...)` → `articleRepository.updateUnfurledDetails(...)`

4h. Remove now-unused imports:
```kotlin
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import com.jayteealao.trails.data.local.database.Article  // only if Article is no longer used anywhere in the VM
```
NOTE: `Article` is still used as a parameter type in `insertArticle(article: Article)` and `saveUrl()`'s internal construction — keep that import.

**Step 5 — Delete `GetArticleWithTextUseCase.kt`**
Hard-delete `android/app/src/main/java/com/jayteealao/trails/usecases/GetArticleWithTextUseCase.kt`. No other callers exist (grep confirms: only `ArticleListViewModel.kt` and `ArticleListViewModelTest.kt` reference the class — both are updated in steps 4 and 6). No explicit `@Provides` or `@Binds` in any DI module — Hilt resolves via `@Inject constructor` only.

**Step 6 — Update `ArticleListViewModelTest`**
In `android/app/src/test/java/com/jayteealao/trails/screens/articleList/ArticleListViewModelTest.kt`:

6a. Remove `@MockK private lateinit var getArticleWithTextUseCase: GetArticleWithTextUseCase` and the `every { getArticleWithTextUseCase.invoke() }` stub.

6b. Remove `@MockK private lateinit var articleDao: ArticleDao` and all `coEvery { articleDao.* }` stubs. The existing test (`saveUrl_whenMetadataFetchFails_usesSharedUrlAndTitleFallback`) currently mocks `articleDao.upsertNewArticle`, `articleDao.getArticleById`, and `articleDao.updateUnfurledDetails` directly — replace all with repo-level stubs.

6c. Add repo-level stubs in `setUp()`:
```kotlin
coEvery { articleRepository.saveNewArticle(any()) } answers {
    firstArg<Article>().itemId  // return the itemId as the upserted ID
}
coEvery { articleRepository.getArticleById(any()) } returns Article(
    itemId = "test", url = "https://example.com/article", givenUrl = "https://example.com/article"
)
coEvery { articleRepository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) } returns Unit
coEvery { articleRepository.upsertArticle(any()) } returns Unit
```

6d. Update `ArticleListViewModel(...)` constructor call in the test to remove `getArticleWithTextUseCase` and `articleDao` args:
```kotlin
val viewModel = ArticleListViewModel(
    articleRepository = articleRepository,
    ioDispatcher = dispatcher,
)
```

6e. Add new test verifying repo boundary:
```kotlin
@Test
fun `saveUrl routes data access through repository not DAO`() = runTest {
    val dispatcher = StandardTestDispatcher(testScheduler)
    Dispatchers.setMain(dispatcher)
    // ... (same unfurler mock setup as existing test) ...
    val viewModel = ArticleListViewModel(articleRepository = articleRepository, ioDispatcher = dispatcher)
    viewModel.saveUrl(sharedUri, "Test title")
    advanceUntilIdle()

    coVerify(exactly = 1) { articleRepository.saveNewArticle(any()) }
    coVerify(exactly = 1) { articleRepository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    // confirm no direct DAO access (articleDao is no longer in the graph — this is structural)
}
```

**Step 7 — Verify imports and build**
Scan `ArticleListViewModel.kt` for any remaining `articleDao.` references. Confirm the file compiles by running:
```
./gradlew :app:compileDebugKotlin
```

**Step 8 — Run verification**
```
./gradlew :app:testDebugUnitTest
```
Expected: all existing tests pass; the new repo-boundary test passes; `ArticleListViewModelTest.saveUrl_whenMetadataFetchFails_usesSharedUrlAndTitleFallback` stays green (now asserting against repo mocks).

## Test / Verification Plan

**Automated only (no interactive verification needed for this slice):**

| Test | File | Gradle task |
|---|---|---|
| `saveUrl_whenMetadataFetchFails_usesSharedUrlAndTitleFallback` (updated) | `test/.../screens/articleList/ArticleListViewModelTest.kt` | `./gradlew :app:testDebugUnitTest` |
| `saveUrl routes data access through repository not DAO` (new) | same file | same task |
| Existing repo unit tests (stay green) | `test/.../data/DefaultArticleRepositoryTest.kt` | same task |

The structural absence of `ArticleDao` from the ViewModel constructor is the primary proof that no direct DAO access remains — there is no `articleDao` field to call through. The test verifies the repo path is invoked with the right call counts.

Gradle test task: `./gradlew :app:testDebugUnitTest`
Build verification task: `./gradlew :app:compileDebugKotlin`

## Risks / Watchouts

**HIGH — Must sequence strictly after article-repository (B3)**
`ArticleRepositoryImpl` constructor is modified by B3 (Firebase injection) before this slice. List-viewmodel adds methods to the same file. Landing list-viewmodel before B3 risks a three-way conflict and builds on the wrong constructor shape. Hard gate: B3 merged and green before implementation starts.

**MED — `saveUrl()` transaction semantics must be preserved**
`upsertNewArticle` is `@Transaction`-annotated in `ArticleDao`. The new `saveNewArticle` repo method delegates directly to `articleDao.upsertNewArticle` — no wrapper transaction needed. The undo-race guard (`getArticleById` + `updateUnfurledDetails`) must stay in sequence on `ioDispatcher`. The new repo methods must NOT add re-dispatch inside their implementations.

**MED — Cross-slice overlap with cross-cutting-url (B9)**
`ArticleListViewModel.kt` is also touched by B9 (reuse-10: `Article.computeNormalizedUrl()` replaces inline `normalizeUrl()` calls in `insertArticle()` and `saveUrl()`). Both slices edit the same function bodies. Sequence B5 before B9 and leave a note for the B9 implementer to pick up the rebased file, OR coordinate the merge explicitly. The B9 implementer must be aware of the DAO→repo rename in these functions.

**LOW — `insertArticle()` is a thin wrapper around `articleDao.upsertArticle()`**
The method is called from the UI layer (share-intent path). Moving it behind the repo is correct and safe. The new `upsertArticle(Article)` repo method is a one-liner delegation — no semantic risk.

**LOW — `GetArticleWithTextUseCase` deletion is a hard cutover**
Only two files reference the class (ViewModel + its test). Both are updated in this slice. No `@Binds`/`@Provides` in any DI module. No risk of broken compile if the grep is confirmed before deletion.

## Dependencies on Other Slices

| Slice | Direction | Dependency |
|---|---|---|
| `article-repository` (B3) | prerequisite | Extends `ArticleRepository.kt` — this slice must sequence after B3 is merged. Hard dependency. |
| `app-scope` (A4) | transitive prerequisite | A4 modifies the `ArticleRepositoryImpl` constructor before B3; B3 must land after A4. B5 inherits the post-A4+B3 shape. |
| `test-net` (E1) | prerequisite | Provides the revived `DefaultArticleRepositoryTest` environment; B5 extends the same test infra. |
| `cross-cutting-url` (B9) | conflict-prone sibling | Both touch `ArticleListViewModel.kt`. Sequence B5 before B9 or coordinate merge. Flag for the B9 plan. |
| `detail-viewmodel` (B4) | independent | Touches `ArticleDetailViewModel.kt` only — no conflict. |

## Assumptions

1. `article-repository` (B3) is merged and `ArticleRepositoryImpl` has the post-B3 constructor shape before this slice begins implementation.
2. `GetArticleWithTextUseCase` has exactly two referencing files: `ArticleListViewModel.kt` and `ArticleListViewModelTest.kt`. (Confirmed by grep — 4 files returned, one is `usecases/GetArticleWithTextUseCase.kt` itself, one is `README.md` which is not compiled.)
3. `articleRepository.pockets()` exists on the `ArticleRepository` interface with identical semantics to `GetArticleWithTextUseCase.invoke()`. (Confirmed: both return `PagingSource<Int, ArticleItem>` via `articleDao.getArticlesWithTags()`.)
4. `ioDispatcher` must be kept in the ViewModel constructor — it is still used in `insertArticle`, `saveUrl`, `regenerateArticleDetails`, `setFavorite`, `setReadStatus`, `archiveArticle`, `deleteArticle`, and `search`.
5. No `@Provides` or `@Binds` in any DI module references `GetArticleWithTextUseCase` by name. (Confirmed by grep — only the use case class itself, the ViewModel constructor, and the test file reference it.)
6. `ArticleDao.upsertNewArticle` carries `@Transaction` at the DAO layer. The repo delegation preserves this transparently — Room's `@Transaction` applies at the DAO call boundary regardless of the call depth.
7. `Article` import stays in `ArticleListViewModel.kt` (the type is still used as a parameter in `insertArticle` and in `saveUrl`'s `Article(...)` constructor call).

## Blockers

None. All information required to implement is available from static analysis. Soft prerequisite: `article-repository` (B3) and `app-scope` (A4) must be implemented and merged first. `test-net` (E1) must also be green for the test additions to compile cleanly.

## Freshness Research

Reusing findings from `02-shape.md` § Freshness Research — no new external constraints for this slice:

From `02-shape.md`:
> **Room 2.8.0 (efficiency-3/10)** — `@Insert(List)`/`@Delete(List)` are auto-transactional; use `@Transaction`/`withTransaction {}` only for multi-op atomicity. KSP (not kapt) on Kotlin 2.x. Source: Room docs.

The `@Transaction` on `upsertNewArticle` is at the DAO layer and is not affected by the repo delegation. No Room schema changes in this slice.

No Firestore, Coil, Compose, or coroutine-scope freshness constraints apply to this slice. The coroutine threading pattern (`viewModelScope.launch(ioDispatcher)`) is unchanged — all existing dispatcher usage is preserved.

No additional web search required. The only Android-specific pattern in scope (thin repo delegation + `@HiltViewModel` constructor param removal) is a standard Hilt/Room idiom with no version-specific risk at the confirmed stack versions.

## Revision History

_(none — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app list-viewmodel`

Prerequisites: `test-net` (E1), `app-scope` (A4), `fts-search-fix` (A1), and `article-repository` (B3) must be implemented and merged first. Once B3 is green, this slice can proceed directly with the three steps: add repo methods, rewrite ViewModel, delete use case, update tests.
