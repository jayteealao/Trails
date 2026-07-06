---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: streaming-restore
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 3
metric-step-count: 11
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-change, resource-safety, restore, efficiency-5]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-streaming-restore.md
  siblings:
    - 03-slice-test-net.md
    - 03-slice-batched-tag-reads.md
    - 03-slice-firestore-io.md
  implement: 05-implement-streaming-restore.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app streaming-restore"
---

# Plan: Constant-memory streamed restore (efficiency-5 + A2b)

## Current State

`FirestoreBackupService.restoreAllArticlesPaginated` (lines 365–426) fetches Firestore articles in
pages of `RESTORE_PAGE_LIMIT=50` but accumulates every page into a single `allArticles:
MutableList<Article>` that grows unboundedly — defeating its own purpose and risking OOM on large
libraries.

**Signature (current):**
```kotlin
suspend fun restoreAllArticlesPaginated(
    onProgress: (current: Int, total: Int) -> Unit = { _, _ -> }
): Result<List<Article>>
```

The function: (1) fetches a count aggregate; (2) loops with cursor pagination (`.startAfter(lastDoc)
.limit(50)`); (3) calls `allArticles.addAll(articles)` per page; (4) returns `Result.success(allArticles)`.

**A2b gap:** `restoreAllArticlesPaginated` never checks whether `article.text == null` (indicating the
text was stored in the `articles/{id}/text/content` subcollection). The single-article `restoreArticle()`
already performs this rehydration (lines 295–308) — the bulk restore path lacks parity.

**Deprecated method:** `restoreAllArticles()` (lines 340–358) exists with a `@Deprecated(WARNING)`
annotation. It loads ALL articles in a single query — the original OOM source. Its KDoc warns against
use. The PO has scoped hard cutover: remove it entirely in this slice.

**Two call sites for `restoreAllArticlesPaginated`** in `FirestoreSyncManager.kt`:
1. Line ~427: first-sync restore branch (`localCount==0 && remoteCount>0`). Calls
   `.fold { remoteArticles -> withContext(IO) { remoteArticles.chunked(50) { ... handleRemoteArticleChange } } }`.
2. Line ~492: `performBidirectionalSync()`. Same fold+chunked(50) pattern.

No callers of `restoreAllArticles()` (deprecated) were found in the grep — it is called nowhere
in-app, confirming it is safe to delete without caller updates.

**Room write pattern:** `handleRemoteArticleChange(remoteArticle)` calls `articleDao.upsertArticle()`
and `articleDao.insertArticleTags()` per article. `ArticleDao.upsertArticles(List<Article>)` exists
and is auto-transactional (Room 2.8 `@Upsert(List)`). The per-article call in `handleRemoteArticleChange`
is not changed by this slice (tag merging and conflict resolution remain per-article; bulk DAO ops are
scoped to the `firestore-io` slice).

**Dispatcher pattern:** `FirestoreSyncManager` switches to `Dispatchers.IO` via `withContext(IO)` around
Room writes. The new `onPage` callback runs inside the `while (hasMore)` loop; the caller must supply
`withContext(IO)` around `handleRemoteArticleChange` calls in the callback (same as today).

## Reuse Opportunities

- `restoreArticle()` (lines 281–321) already contains the A2b rehydration logic:
  ```kotlin
  if (article != null && article.text == null) {
      val textDoc = articleRef.collection(ARTICLE_TEXT_COLLECTION).document("content").get().await()
      if (textDoc.exists()) { article = article.copy(text = textDoc.getString("text")) }
  }
  ```
  Inline-extract this into a private `suspend fun rehydrateLargeText(article: Article, articleRef: DocumentReference): Article`
  helper. Call it from both `restoreArticle()` and the new per-page loop in `restoreAllArticlesPaginated`.

- The cursor-pagination loop (query construction, `lastDocument`, `hasMore` flag) is correct and reused
  verbatim in the new implementation — only the `allArticles.addAll(articles)` line is replaced with
  `onPage(hydratedArticles)`.

## Likely Files / Areas to Touch

| File | Role | Action |
|---|---|---|
| `services/firestore/FirestoreBackupService.kt` | Core: restoreAllArticlesPaginated + A2b | Modify |
| `services/firestore/FirestoreSyncManager.kt` | Both call sites | Modify |
| `services/firestore/FirestoreBackupServiceTest.kt` | A2 + A2b tests + characterization update | Modify |

**NOT touched in this slice:** `ArticleDao.kt`, `ArticleRepository.kt`, tag-read batching (→
`batched-tag-reads`), write-path batching (→ `firestore-io`), `SyncWorker.kt`.

## Proposed Change Strategy

### API Shape Decision: `suspend onPage callback` (RECOMMENDED) over `Flow<List<Article>>`

**Evidence from call sites:**

Both `FirestoreSyncManager` call sites currently do:
```kotlin
val remoteResult = firestoreBackupService.restoreAllArticlesPaginated(onProgress = { ... })
remoteResult.fold(
    onSuccess = { remoteArticles ->
        withContext(Dispatchers.IO) {
            remoteArticles.chunked(50).forEachIndexed { _, chunk ->
                chunk.forEach { handleRemoteArticleChange(it) }
            }
        }
    },
    onFailure = { throw it }
)
```

With a `suspend onPage: suspend (List<Article>) -> Unit` callback:
```kotlin
firestoreBackupService.restoreAllArticlesPaginated(
    onProgress = { current, total -> ... },
    onPage = { pageArticles ->
        withContext(Dispatchers.IO) {
            pageArticles.forEach { handleRemoteArticleChange(it) }
        }
    }
).onFailure { throw it }
```

The outer `chunked(50)` evaporates because `RESTORE_PAGE_LIMIT=50` already produces page-sized chunks.
The `fold {}` collapses to `.onFailure {}`. The return type changes from `Result<List<Article>>` to
`Result<Unit>` (all data was delivered via `onPage`; there is nothing to return).

**Why not `Flow<List<Article>>`:**
- Flow requires the caller to call `.collect {}` inside a coroutine scope, adding boilerplate at both
  call sites.
- The `Result<T>` error-return idiom used throughout `FirestoreBackupService` does not compose cleanly
  with Flow (would need a `Flow<Result<List<Article>>>` or a catch block).
- Cancellation semantics are identical: the coroutine scope of the calling `performFullSync`/
  `performBidirectionalSync` function is the cancellation boundary for both shapes.
- Backpressure is equivalent: the callback blocks the paging loop until Room writes complete, naturally
  rate-limiting Firestore page fetches without a buffered channel.

**Tradeoff:** The callback shape is less compositional (can't be shared across multiple consumers without
replay); if a second consumer ever needs the stream, it would require refactoring to Flow. At this scope
(two in-app callers, single-consumer), the callback is the right call.

### A2b: Large-text Rehydration in Bulk Restore

Extract a private `suspend fun rehydrateLargeText(article: Article, articleRef: DocumentReference): Article`
helper from the existing `restoreArticle()` logic. Call it inside the per-page loop in
`restoreAllArticlesPaginated` — after deserialising each `Article` from a `DocumentSnapshot`, before
passing it to `onPage`. Articles with non-null text are returned unchanged (no extra read). This brings
bulk restore to parity with single-article restore.

### Hard Cutover: Remove `restoreAllArticles()`

`restoreAllArticles()` has zero in-app callers (grep confirmed). Delete the function body and its
`@Deprecated` annotation. No caller update required.

## Step-by-Step Plan

**Step 1 — Extract `rehydrateLargeText` helper (FirestoreBackupService.kt)**
Pull the null-text subcollection fetch from `restoreArticle()` into a private
`suspend fun rehydrateLargeText(article: Article, articleRef: DocumentReference): Article`.
Add a `Timber.w` on subcollection fetch failure (consistent with current catch block).
Update `restoreArticle()` to call the helper — no behaviour change, just extraction.

**Step 2 — Redesign `restoreAllArticlesPaginated` (FirestoreBackupService.kt)**
Change the signature to:
```kotlin
suspend fun restoreAllArticlesPaginated(
    onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
    onPage: suspend (List<Article>) -> Unit = {}
): Result<Unit>
```
Inside the `while (hasMore)` loop, replace `allArticles.addAll(articles)` with:
```kotlin
val hydratedArticles = articles.map { article ->
    val articleRef = getUserArticlesCollection(user.uid).document(article.itemId)
    rehydrateLargeText(article, articleRef)
}
onPage(hydratedArticles)
```
Return `Result.success(Unit)` on completion. Keep the count-aggregate fetch and cursor pagination
loop unchanged. Add `Timber.d` before `onPage` call to log page number and size for lazylogcat
tracing during the A2 interactive smoke test.

**Step 3 — Remove `restoreAllArticles()` (FirestoreBackupService.kt)**
Delete the function and its `@Deprecated` annotation block entirely (lines 328–358). No callers exist.

**Step 4 — Update call site 1: first-sync restore branch (FirestoreSyncManager.kt, ~line 427)**
Replace:
```kotlin
val remoteResult = firestoreBackupService.restoreAllArticlesPaginated(onProgress = { ... })
remoteResult.fold(
    onSuccess = { remoteArticles ->
        withContext(Dispatchers.IO) {
            remoteArticles.chunked(50).forEachIndexed { _, chunk -> chunk.forEach { handleRemoteArticleChange(it) } }
        }
        _syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")
    },
    onFailure = { throw it }
)
```
With:
```kotlin
firestoreBackupService.restoreAllArticlesPaginated(
    onProgress = { current, total ->
        _syncStatus.value = SyncStatus.Syncing
        Timber.d("Restoring $current / $total articles")
    },
    onPage = { pageArticles ->
        withContext(Dispatchers.IO) {
            pageArticles.forEach { handleRemoteArticleChange(it) }
        }
    }
).onFailure { throw it }
_syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")
```

**Step 5 — Update call site 2: `performBidirectionalSync` (FirestoreSyncManager.kt, ~line 492)**
Same transformation as Step 4. Replace the fold+chunked(50) block. The `if (remoteArticles.isNotEmpty())`
guard moves into the `onPage` lambda as an early return (or is simply removed — empty pages are never
delivered by the new implementation since the `while (hasMore)` loop breaks on empty snapshot).

**Step 6 — Update characterization test (FirestoreBackupServiceTest.kt)**
The test-net plan adds a characterization test that pins the current OOM accumulation behaviour as a
baseline (`assertEquals(100, result.getOrThrow().size)`). That test must be updated or replaced:
- Remove the list-accumulation assertion (the new API returns `Result<Unit>`).
- Add a comment noting the test now asserts the fixed streaming behaviour.
This step is conditional: only required if the test-net slice has already been implemented when this
slice lands. If test-net is not yet implemented, skip this step (the new tests below supersede the
baseline entirely).

**Step 7 — Write A2 streaming-API tests (FirestoreBackupServiceTest.kt)**
Using MockK + `runTest` + `StandardTestDispatcher`. Mock Firestore to return:
- Multi-page scenario: two page responses of 50 articles each, then an empty page. Assert `onPage` is
  called exactly twice; assert neither call receives more than 50 articles; assert return is
  `Result.success(Unit)`.
- Zero articles: count query returns 0, first page query returns empty. Assert `onPage` never called;
  return is `Result.success(Unit)`.
- Single page: one response of 30 articles, then empty. Assert `onPage` called once with 30 articles.
- `onPage` throws on first call: assert `Result.failure` returned; assert `onPage` not called a second
  time (paging stops on first failure).
- Cancellation: cancel the coroutine scope before the second page query is issued; assert no second
  `onPage` call and no uncaught exception (cooperative cancellation via structured concurrency — the
  suspended `query.get().await()` will throw `CancellationException` which propagates up and is caught
  by the `try/catch`; log at `Timber.d` level and return `Result.failure`).

**Step 8 — Write A2b large-text rehydration test (FirestoreBackupServiceTest.kt)**
- Happy path: mock an article doc with `text == null`; mock `articles/{id}/text/content` returning
  `{ "text": "large content" }`. Assert the article passed to `onPage` has `text == "large content"`.
- Inline-text path: mock an article doc with `text == "short"`. Assert no subcollection GET is issued
  (verify `articleRef.collection("text")` never called). Assert article passed to `onPage` has
  `text == "short"`.
- Subcollection missing: mock an article with `text == null` but `text/content` doc does not exist.
  Assert article passed to `onPage` has `text == null` (graceful; no exception).

**Step 9 — Run automated checks**
```
./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"
```
All new and existing tests must pass. The `FirestoreSyncManagerTest` (test-net slice) tests that
called `restoreAllArticlesPaginated` must be updated to supply a no-op `onPage = {}` default (the
default is provided in the signature, so existing call sites without `onPage` still compile).

**Step 10 — Interactive A2 smoke: Android Studio memory profiler + lazylogcat**
On an emulator with the app signed in to a test account with ≥200 articles in Firestore:
1. Clear local Room database (or use a fresh device profile).
2. Launch the app; trigger a sync/restore.
3. Observe Android Studio Memory Profiler: heap should not sustain a growing allocation across pages.
   Each page's article objects should be GC-eligible after `handleRemoteArticleChange` returns.
4. Capture lazylogcat filtered to `FirestoreBackupService` and `FirestoreSyncManager` tags:
   - Confirm "Restored X / Y articles" log lines appear per-page (not once at the end).
   - Confirm "onPage called with Z articles" per page (from Step 2 Timber.d).
5. Evidence threshold: no sustained heap growth across page boundaries; all articles appear in Room.

**Step 11 — Cross-slice coordination flag**
`FirestoreBackupService.kt` is shared with `firestore-dedup`, `firestore-io`, and `batched-tag-reads`
slices. This slice changes the public API of `restoreAllArticlesPaginated`. The `firestore-dedup` plan
must not further change this function's signature; `batched-tag-reads` and `firestore-io` touch
different function surfaces. Confirm with those plans before sequencing implementation.

## Test / Verification Plan

### Automated checks

**Gradle test task:**
```
./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"
```

| Test | AC | Assertion |
|---|---|---|
| `restoreAllArticlesPaginated calls onPage per page not once with full list` | A2 | `onPage` called N times for N pages |
| `restoreAllArticlesPaginated zero articles never calls onPage` | A2 | `verify(exactly = 0) { onPage(any()) }` |
| `restoreAllArticlesPaginated single page calls onPage once` | A2 | `verify(exactly = 1) { onPage(any()) }` |
| `restoreAllArticlesPaginated onPage failure stops paging and returns failure` | A2 | `result.isFailure`, `onPage` called once |
| `restoreAllArticlesPaginated cancellation stops before next page` | A2 | no second page fetch after cancel |
| `restoreAllArticlesPaginated rehydrates large text from subcollection` | A2b | article text non-null after onPage |
| `restoreAllArticlesPaginated inline text not fetched from subcollection` | A2b | subcollection GET not invoked |
| `restoreAllArticlesPaginated missing subcollection text is null` | A2b | article.text==null, no exception |

Existing `FirestoreBackupServiceTest` tests (backup marker writes, `writeArticleMarker`, `backupArticles`)
must remain green — these surfaces are not modified.

### Interactive verification

**A2 — Memory profiler smoke (emulator):**
- Tool: Android Studio Memory Profiler + lazylogcat (skill: lazylogcat)
- Trigger: full sync/restore on a clean device profile with ≥200 remote articles
- Evidence: per-page log lines appear in logcat; heap profile shows no sustained growth across pages
- Pass criterion: no OOM; heap plateau or sawtooth (allocate page / GC after Room write) replaces the
  monotonic climb of the current implementation

## Risks / Watchouts

1. **[HIGH] A2b adds per-article subcollection reads in the bulk path.** Every article with `text==null`
   incurs an extra Firestore GET. For libraries with many large-text articles this is significant read
   cost but is the correct behaviour (parity with `restoreArticle()`). Accept; document in architecture
   docs.

2. **[MED] Partial-restore state on onPage failure.** No transactional rollback. Room is left with
   articles from delivered pages; a subsequent sync will fill gaps via idempotent upsert. Add KDoc
   warning and Timber.w log.

3. **[MED] Characterization test update dependency.** If the test-net slice has already landed, the
   baseline OOM test must be replaced as part of Step 6. The `FirestoreSyncManagerTest`
   characterization test that calls `restoreAllArticlesPaginated` will need to supply `onPage = {}`
   (this is the default, so it compiles without change — only the assertion `result.getOrThrow().size`
   needs removal/update).

4. **[LOW] Return type change from `Result<List<Article>>` to `Result<Unit>`.** Callers are fully
   enumerated (two sites in `FirestoreSyncManager`; no others). Both sites are updated in Steps 4–5.
   The Kotlin compiler will catch any missed call site.

5. **[LOW] `rehydrateLargeText` adds Firestore reads inside the paging loop.** These are sequential
   (one per article per page), not parallelised. For a page of 50 articles each with large text, this
   is 50 sequential GETs before `onPage` is called. This is acceptable for a restore path (infrequent,
   background). Parallelisation is a future optimisation.

## Dependencies on Other Slices

- **`test-net` (prerequisite):** Characterization tests must be green before this slice lands (the
  baseline restoreAllArticlesPaginated test must be updated in Step 6). The test harness
  (`FirestoreBackupServiceTest` setup with MockK) is reused directly by the new tests.
- **`firestore-dedup` (downstream, not a gate):** The `firestore-dedup` slice extracts helpers from
  `FirestoreBackupService`. It must not change the `restoreAllArticlesPaginated` signature after this
  slice sets it — coordinate sequencing.
- **`firestore-io` (downstream, not a gate):** Touches write-path batching and bulk Room ops in
  `FirestoreSyncManager`. Not in conflict — targets different functions (`backupArticle`,
  `addArticleToBatch`).
- **`batched-tag-reads` (downstream, not a gate):** Targets tag subcollection reads in
  `handleRemoteArticleChange`. Not in conflict — different function surface, same file
  (`FirestoreSyncManager.kt`).

## Assumptions

1. No callers of `restoreAllArticles()` exist outside `android/` (grep confirmed — zero hits).
2. `restoreAllArticlesPaginated` has exactly two call sites in `FirestoreSyncManager.kt` (grep confirmed
   at lines ~427 and ~492). No other in-app callers.
3. The `RESTORE_PAGE_LIMIT=50` constant is appropriate for the A2b per-page large-text fetch (50 serial
   GETs per page is acceptable latency on a restore path). If not, reducing the page size is a simple
   constant change.
4. `handleRemoteArticleChange` remains a per-article suspend function (not batch-refactored in this
   slice). Bulk DAO ops are deferred to `firestore-io`.
5. The `test-net` slice has established (or will establish before this slice is implemented)
   a MockK-based `FirestoreBackupServiceTest` harness that the new tests extend.
6. Room 2.8.0 `@Upsert(List)` is available (confirmed in `libs.versions.toml`).

## Blockers

None.

## Freshness Research

Carried from `02-shape.md` freshness section (no new web search required for this slice):

- **Room 2.8.0** — `@Upsert(List)` / `@Insert(List)` are auto-transactional; `@Transaction` /
  `withTransaction {}` only needed for multi-op atomicity. KSP on Kotlin 2.x. Per-article
  `upsertArticle()` call in `handleRemoteArticleChange` unchanged by this slice; bulk ops deferred
  to `firestore-io`.
- **Firestore pagination** — cursor-based pagination via `.startAfter(lastDocument).limit(N)` is the
  correct approach. The existing implementation is already correct; only the accumulation is fixed.
- **Coroutines / cancellation** — `suspend fun onPage` inside a `try { ... } catch (e: Exception)`
  block: `CancellationException` is a subtype of `Exception` in Kotlin; re-throw it explicitly to
  preserve cooperative cancellation:
  ```kotlin
  } catch (e: Exception) {
      if (e is CancellationException) throw e
      Timber.e(e, "Failed to restore articles with pagination")
      Result.failure(e)
  }
  ```
  This is a correctness fix the current implementation also lacks — include it in Step 2.
- **No new CVEs or version bumps** in scope for this slice.

## Revision History

_(empty — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app streaming-restore`

Prerequisite: `test-net` slice implemented and green (characterization baseline established).
Implement Steps 1–8 (code), then Step 9 (run tests), then Step 10 (interactive smoke). Step 11
(cross-slice flag) is a coordination check, not a blocking step.
