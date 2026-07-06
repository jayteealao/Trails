---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: batched-tag-reads
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 8
has-blockers: false
revision-count: 0
tags: [efficiency, firestore, batching, behaviour-change, android]
stack-source: confirmed
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-batched-tag-reads.md
  siblings: [03-slice-test-net.md, 03-slice-streaming-restore.md, 03-slice-firestore-dedup.md]
  implement: 05-implement-batched-tag-reads.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app batched-tag-reads"
---

# Plan: Batched tag reads on restore (efficiency-4)

## Current State

### The N+1 loop

`FirestoreSyncManager.handleRemoteArticleChange()` (lines 82–134 of `FirestoreSyncManager.kt`) calls
`firestoreBackupService.restoreArticleTags(remoteArticle.itemId)` **once per article**, sequentially,
inside the restore loop:

```kotlin
// FirestoreSyncManager.kt lines 93 and 110 — both call sites
val remoteTags = firestoreBackupService.restoreArticleTags(remoteArticle.itemId)
```

`restoreArticleTags` (lines 431–451 of `FirestoreBackupService.kt`) fires a Firestore collection
get against:

```
users/{uid}/articles/{articleId}/tags/   (all docs in subcollection)
```

The caller loop (in both `performBidirectionalSync` and `performFullSync` Scenario 2) is:

```kotlin
remoteArticles.chunked(50).forEachIndexed { chunkIndex, chunk ->
    chunk.forEach { remoteArticle ->
        handleRemoteArticleChange(remoteArticle)   // <-- one Firestore read per article
    }
}
```

For N remote articles this issues N sequential subcollection reads. With 1000 articles that is 1000
round-trips to Firestore before any article is written to Room.

### Firestore path shape

```
users/{uid}/articles/{articleId}/tags/{tagId}
```

Tag documents carry fields: `itemId`, `tag`, `sortId`, `type`. **There is no `userId` field on the
tag document itself.** All tags are 4 levels deep under the authenticated user's path.

### Firestore rules

`firebase/firestore.rules` is already `rules_version = '2'`. Tags are covered by:

```
match /users/{userId}/articles/{articleId}/tags/{tagId} {
  allow read, write: if isOwner(userId);
}
```

This is a concrete path match, not a wildcard.

### No `firestore.indexes.json` exists

The `firebase/` directory contains only `firestore.rules` and `.firebaserc`. There is no
`firestore.indexes.json` in the project.

### Call-site inventory

`handleRemoteArticleChange` is called from exactly two sites — both in `FirestoreSyncManager.kt`:

| Site | Line range | Context |
|---|---|---|
| `performFullSync` → Scenario 2 (new device restore) | ~441 | `chunk.forEach { remoteArticle -> handleRemoteArticleChange(remoteArticle) }` |
| `performBidirectionalSync` | ~510 | `chunk.forEach { remoteArticle -> handleRemoteArticleChange(remoteArticle) }` |

Both are inside `remoteArticles.chunked(50)` loops. Both must be updated.

---

## Reuse Opportunities

- `RESTORE_PAGE_LIMIT = 50` already defined as a companion constant in `FirestoreBackupService` —
  the tag-chunk size can sit alongside it as `RESTORE_TAG_CHUNK_SIZE = 10`.
- `kotlinx-coroutines` `coroutineScope { }` + `async { }` + `awaitAll()` — already on the
  classpath (coroutines used throughout). No new dependency.
- `MockK` + `StandardTestDispatcher` + `advanceUntilIdle()` — already the test pattern; reuse for
  the read-count assertion tests.
- The existing `restoreArticleTags(articleId)` stays as a public API for single-article use
  (e.g. `restoreArticle`). The new `batchRestoreArticleTags` is additive.

---

## Likely Files / Areas to Touch

| File | Why | Status |
|---|---|---|
| `services/firestore/FirestoreBackupService.kt` | Add `batchRestoreArticleTags()` batched fetch | Modify |
| `services/firestore/FirestoreSyncManager.kt` | Refactor restore loop to use batched fetch; extract `applyRemoteArticles()` | Modify |
| `services/firestore/FirestoreBackupServiceTest.kt` | Read-count reduction test + edge cases | Modify |
| `services/firestore/FirestoreSyncManagerTest.kt` | Update characterization tests; add integration-path test | Modify |

**Not touched by this slice:**
- `firebase/firestore.rules` — no collectionGroup query; existing per-path rules are sufficient.
- `firebase/firestore.indexes.json` — does not exist; client-only approach needs no index.
- Any other file in `android/` — scoped to the Firestore backup/sync layer only.
- `warg/` — out of scope for the entire workflow.

---

## Proposed Change Strategy

### Elected approach: chunked parallel coroutines (client-only, no Firestore deploy)

**Rationale for rejecting collectionGroup:**

1. **No `userId` field on tag documents.** A `collectionGroup("tags")` query must be able to filter
   to the authenticated user's tags. Since tag docs carry `itemId`/`tag`/`sortId`/`type` but no
   `userId`, a collectionGroup query cannot express `WHERE userId = uid`. Without that filter, the
   query would return tags from all users' articles — a security violation. Fixing this would require
   a schema migration (adding `userId` to every tag doc) which is out of scope.

2. **No `firestore.indexes.json` exists.** The project has no index file to add a
   `COLLECTION_GROUP`-scoped composite index to. Creating one solely for this slice would introduce
   infra complexity and a deploy-gated step for no correctness gain (point 1 already blocks it).

3. **rules_version='2' is already present.** The prerequisite is met, but without a qualifying
   collectionGroup query shape, it does not unlock anything here.

4. **Client-only batching is sufficient for A3.** The acceptance criterion is "total Firestore tag
   reads are sub-N+1 (batched)." Parallel concurrent dispatch of subcollection reads achieves this:
   N sequential reads → ceil(N/CHUNK_SIZE) parallel batches, each completing in one round-trip.

**Chosen shape: `batchRestoreArticleTags(articleIds)`**

```kotlin
// FirestoreBackupService.kt — new method
suspend fun batchRestoreArticleTags(
    articleIds: List<String>
): Map<String, List<ArticleTags>> {
    if (articleIds.isEmpty()) return emptyMap()
    val user = getCurrentUser() ?: return emptyMap()
    return coroutineScope {
        articleIds
            .chunked(RESTORE_TAG_CHUNK_SIZE)   // <= 10 ids/chunk
            .flatMap { chunk ->
                chunk.map { articleId ->
                    async {
                        val snap = getUserArticlesCollection(user.uid)
                            .document(articleId)
                            .collection(TAGS_COLLECTION)
                            .get()
                            .await()
                        articleId to snap.documents.mapNotNull { it.toObject(ArticleTags::class.java) }
                    }
                }
            }
            .awaitAll()
            .toMap()
    }
}
```

Chunk size 10 means N=1000 articles → 100 parallel rounds (10 concurrent reads each) rather than
1000 sequential reads. Wall-clock time scales as ceil(N/10) round-trips, not N.

**Caller refactor shape in `FirestoreSyncManager`:**

Extract `applyRemoteArticles(articles, tagsByArticleId)` that:
1. Calls `batchRestoreArticleTags(articles.map { it.itemId })` once for the whole chunk.
2. Iterates articles, calling `handleRemoteArticleChange(article, tagsByArticleId[article.itemId] ?: emptyList())`.

`handleRemoteArticleChange` gains a `tags: List<ArticleTags>` parameter (removes its internal
Firestore call entirely).

Both restore call sites in `performFullSync` and `performBidirectionalSync` swap their
`chunk.forEach { handleRemoteArticleChange(it) }` loops for `applyRemoteArticles(chunk, ...)`.

---

## Step-by-Step Plan

### Phase A: Add `batchRestoreArticleTags` to `FirestoreBackupService` (no caller change yet)

**Step 1.** Add `RESTORE_TAG_CHUNK_SIZE = 10` constant to `FirestoreBackupService.companion object`.

**Step 2.** Add `suspend fun batchRestoreArticleTags(articleIds: List<String>): Map<String, List<ArticleTags>>`
using the `coroutineScope + async + awaitAll` shape above. Keep the existing `restoreArticleTags`
single-article method unchanged (still used by `restoreArticle`).

### Phase B: Write read-count tests for `batchRestoreArticleTags`

**Step 3.** In `FirestoreBackupServiceTest.kt`, add tests using MockK to count Firestore collection
`get()` invocations:
- `batchRestoreArticleTags(emptyList())` → 0 reads, returns empty map.
- `batchRestoreArticleTags(listOf("a1"))` → 1 read, returns `{"a1": [...]}`
- `batchRestoreArticleTags(10 ids)` → 10 reads in one round (all parallel, no sequential wait).
- `batchRestoreArticleTags(11 ids)` → 11 reads in two rounds (chunk 1 = 10, chunk 2 = 1).
- Article with no tags → entry with empty list, no crash.

Run: `./gradlew :app:testDebugUnitTest --tests "*FirestoreBackupServiceTest*"`

### Phase C: Refactor `FirestoreSyncManager` — extract `applyRemoteArticles`, update call sites

**Step 4.** Change `handleRemoteArticleChange(remoteArticle: Article)` signature to
`handleRemoteArticleChange(remoteArticle: Article, prefetchedTags: List<ArticleTags>)`.
Remove both internal `firestoreBackupService.restoreArticleTags(remoteArticle.itemId)` calls
(lines 93 and 110). Use `prefetchedTags` directly where tags were previously fetched.

**Step 5.** Extract private `suspend fun applyRemoteArticles(articles: List<Article>)`:
```kotlin
private suspend fun applyRemoteArticles(articles: List<Article>) {
    val tagsByArticleId = firestoreBackupService.batchRestoreArticleTags(
        articles.map { it.itemId }
    )
    withContext(Dispatchers.IO) {
        articles.forEach { article ->
            handleRemoteArticleChange(article, tagsByArticleId[article.itemId] ?: emptyList())
        }
    }
}
```

**Step 6.** Replace both `chunk.forEach { remoteArticle -> handleRemoteArticleChange(remoteArticle) }`
call sites with `applyRemoteArticles(chunk)`. Remove the now-redundant `withContext(Dispatchers.IO)`
wrappers from the two call sites (moved inside `applyRemoteArticles`).

### Phase D: Update `FirestoreSyncManagerTest` characterization tests

**Step 7.** Update existing `handleRemoteArticleChange` tests to pass a `prefetchedTags` parameter
(empty list suffices for most; add one test that exercises the tag-replacement path with a non-empty
list). Add an integration-path test asserting that a 15-article restore triggers exactly 2 calls to
`batchRestoreArticleTags` (chunked into 10+5) and zero calls to `restoreArticleTags`.

Run: `./gradlew :app:testDebugUnitTest --tests "*FirestoreSyncManagerTest*"`

### Phase E: Full test suite pass

**Step 8.** Run the full unit test suite to confirm no regressions:
```
./gradlew :app:testDebugUnitTest
```
Expected: all existing tests pass; new read-count tests pass.

---

## Test / Verification Plan

### Automated (A3 — automated)

Named Gradle task to run read-count reduction tests:
```
./gradlew :app:testDebugUnitTest --tests "*FirestoreBackupServiceTest*" --tests "*FirestoreSyncManagerTest*"
```

Key assertions:
- `batchRestoreArticleTags(N ids)` issues `ceil(N/RESTORE_TAG_CHUNK_SIZE)` round-trips (not N).
- 15-article restore drives `batchRestoreArticleTags` twice (chunks of 10 + 5), zero calls to
  single-article `restoreArticleTags`.
- Edge: empty article list → 0 reads, empty map returned.
- Edge: single article → 1 read, result keyed by articleId.

### Manual (A3 — manual via lazylogcat)

Use `lazylogcat` to capture Firestore read events during a bidirectional sync on emulator/device:

1. Build debug variant: `./gradlew :app:assembleDebug`.
2. Launch `lazylogcat` filtered to `FirestoreBackupService` tag.
3. Trigger a bidirectional sync with ≥15 articles on the remote.
4. Observe: log lines show tag batch fetches grouped (chunk start/end logs), not N individual
   `restoreArticleTags` calls.
5. Compare read-count in Firestore usage dashboard (Firebase console → Firestore → Usage):
   before = N reads per sync; after = ceil(N/10) reads per sync.

Evidence to capture:
- Logcat output with chunk start/end Timber.d lines visible.
- Before/after Firestore read-count from Firebase console (screenshot or note counts).

---

## Risks / Watchouts

### 1. `handleRemoteArticleChange` signature change (medium)

This private method is called from exactly two sites; both must be updated in this slice. The
test-net characterization tests pin existing behaviour. Any missed call site will fail to compile
before merge. Risk: **LOW** in practice (compile-time catch), **MEDIUM** in terms of refactoring
surface (caller logic must be audited carefully at both sites).

### 2. Chunk-size tuning (low)

`RESTORE_TAG_CHUNK_SIZE = 10` is conservative. Firestore allows many concurrent connections from
Android; 10 parallel reads is far below any documented limit. If profiling shows a benefit to
larger chunks (e.g., 25), the constant can be tuned. Cap at 30 to stay at or below the `whereIn`
cap for future refactoring symmetry. Change only the constant — no logic change needed.

### 3. Articles with no tags still incur a Firestore read (low)

`batchRestoreArticleTags` fires a `collection().get()` for every article ID regardless of whether
that article has tags. For pure no-tag libraries, the win is parallel wall-clock reduction not
read-count reduction. The A3 AC is "sub-N+1" — parallel dispatch satisfies "batched" semantics.
If a zero-read approach is needed for tag-less articles, it would require a presence flag in the
article document (out of scope; different data model change).

---

## Dependencies on Other Slices

- **`test-net` (hard gate):** The characterization tests for `FirestoreSyncManager` /
  `FirestoreBackupService` must be green before this slice lands. This slice's new tests rely on
  the test infra revived by `test-net`.
- **`streaming-restore`:** Both touch `FirestoreBackupService.restoreAllArticlesPaginated` and the
  restore loop in `FirestoreSyncManager`. If `streaming-restore` lands first, this slice rebases on
  the new streaming loop shape. If `batched-tag-reads` lands first, `streaming-restore` must ensure
  its streaming loop calls `applyRemoteArticles` (not the old per-article form). **Recommend
  landing `streaming-restore` first, then rebasing `batched-tag-reads`** — the streaming loop is
  the definitive restore path.
- **`firestore-dedup` (B1):** Extracts helpers from `FirestoreBackupService` / `FirestoreSyncManager`.
  No conflict with the new `batchRestoreArticleTags` method (additive); `applyRemoteArticles` is
  also a new extraction that `firestore-dedup` will consolidate alongside `addArticleToBatch` etc.
  Hard-cutover: all internal callers updated within their respective slices.

---

## Assumptions

- **[A1]** `ArticleTags` has no `userId` field — confirmed by reading `FirestoreBackupService` tag
  write at line 191–195 (`batch.set(tagRef, tag, SetOptions.merge())`). The `tag` object is typed
  as `ArticleTags` which carries `itemId`, `tag`, `sortId`, `type` only. A collectionGroup query
  filtering by user is therefore infeasible without a schema migration.
- **[A2]** `coroutineScope { }` is already on the classpath — confirmed (`kotlinx-coroutines-core`
  is a transitive dependency of `firebase-firestore-ktx`).
- **[A3]** `RESTORE_TAG_CHUNK_SIZE = 10` is a safe concurrent Firestore read parallelism level for
  Android (well below documented SDK limits). Tune in implement if needed.
- **[A4]** The `test-net` slice has landed (or its Firestore characterization tests are green) before
  this slice's tests run. If test-net is not yet complete, this slice's new tests can still be
  written; they just require the test harness from test-net to execute.
- **[A5]** `restoreArticle` (single-article restore path) continues using the existing
  `restoreArticleTags` method — that path is not N+1, so it is out of scope.

---

## Blockers

None. Elected approach (chunked parallel coroutines) is client-only. No Firestore index or rules
change required. No shared-project deploy gating. No PO decision pending.

---

## Freshness Research

Carried from `02-shape.md` (confirmed at plan stage, no new external research needed):

| Constraint | Source | Takeaway for this slice |
|---|---|---|
| `collectionGroup` requires `COLLECTION_GROUP` index + `rules_version='2'` wildcard match | Firestore index/queries/rules docs (shape research) | Elected approach avoids this entirely |
| `whereIn` cap = 30 values | Firestore query docs (shape research) | Not applicable to subcollection reads; used as a cap reference for `RESTORE_TAG_CHUNK_SIZE` upper bound |
| `rules_version='2'` already in `firebase/firestore.rules` | Confirmed by reading the file | Prerequisite met but not needed (no collectionGroup query) |
| No `userId` field on `ArticleTags` | Confirmed by reading `FirestoreBackupService.kt` lines 191–195 + `ArticleTags` model | Primary reason collectionGroup is infeasible without schema change |
| No `firestore.indexes.json` in project | Confirmed by filesystem search | Collectiongroup index creation would require creating this file from scratch |
| `coroutineScope + async + awaitAll` pattern | Kotlin coroutines docs (Kotlin 2.x stack) | Standard parallel dispatch pattern, already on classpath |

**New finding at plan stage:** The absence of a `userId` field on `ArticleTags` is the decisive
factor ruling out collectionGroup. This was not visible from the shape's freshness research alone —
it required reading the actual model. This is why the deferred decision was correctly placed in the
plan stage after code inspection.

---

## Revision History

*(none — rev 1 is the initial plan)*

---

## Recommended Next Stage

**Option A (default):** `/wf implement simplify-android-app batched-tag-reads` — implement after
`test-net` is green (hard gate) and ideally after `streaming-restore` has landed (so the streaming
loop is the base to plug `applyRemoteArticles` into). All decisions resolved; no blockers.

**Note on ordering:** If implementing in parallel with `streaming-restore`, take care at merge time:
both slices edit `FirestoreSyncManager`'s restore loop. Coordinate merge order or implement
`batched-tag-reads` on top of the `streaming-restore` branch.
