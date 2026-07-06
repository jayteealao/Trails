---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: firestore-io
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 5
metric-step-count: 9
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, firestore, efficiency, room]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-firestore-io.md
  siblings:
    - 03-slice-firestore-dedup.md
    - 03-slice-test-net.md
  implement: 05-implement-firestore-io.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app firestore-io"
---

# Plan: Firestore read/write efficiency (B2)

## Current State

### efficiency-1 — Two user-meta Firestore reads per sync

In `FirestoreSyncManager.syncLocalChanges()` (lines 221–222), two sequential Firestore GETs are
fired on the same `users/{uid}` document:

```kotlin
val isFirstSync = firestoreBackupService.isFirstSync().getOrNull() ?: false
val lastSync = firestoreBackupService.getLastSyncTimestamp().getOrNull() ?: 0L
```

`isFirstSync()` reads `users/{uid}` and checks `doc.contains("lastSyncTimestamp")`.
`getLastSyncTimestamp()` reads `users/{uid}` and calls `doc.getLong("lastSyncTimestamp")`.

Both read the identical document. Post-B1, these calls go through `withAuthenticatedUser{}` but
remain two separate `.get().await()` calls. The fix is a single `getUserMetaSnapshot()` helper on
`FirestoreBackupService` that reads the doc once and returns the `DocumentSnapshot`, from which
callers extract both fields locally.

**Op reduction:** 2 Firestore GETs → 1 Firestore GET per `syncLocalChanges()` invocation.
`performFullSync()` also calls `isFirstSync()` (line 404) — same fix applies there.

### efficiency-2 — Per-article tag commits in the chunk loop

After B1 lands, `syncLocalChanges()` will delegate the tag-backup for each article to
`firestoreBackupService.backupArticle(...)`. This replaces the raw per-article `firestore.batch()`
calls (current lines 288–316) but still fires one `batch.commit()` per article. For a chunk of N
articles, the tag path commits N separate batches on top of the `backupArticlesPaginated` chunk
commit.

The fix: extend the B1-extracted `addArticleToBatch(batch, articleRef, article)` to also accept
`tags: List<ArticleTags>` and write tag docs into the same batch. Update `backupArticlesPaginated`
to fetch and write tags in the chunk batch. Remove the separate per-article `backupArticle` tag-
delegation in `syncLocalChanges`.

**Op reduction:** N separate `batch.commit()` per chunk for tag-backup → 0 extra commits (tags
folded into the existing chunk commit). The `backupArticlesPaginated` chunk's single commit per
chunk covers articles, markers, AND tags.

**Note on current `backupArticlesPaginated`:** It already commits once per chunk of 20 articles
(WRITE_BATCH_LIMIT=20). The chunk size is governed by the Firestore rules document-access budget
(one `getAfter()` per article = 20 doc-access calls per batch). Adding tag writes does NOT add
`getAfter()` calls (tag subcollection writes have no such rules check). The budget is not breached.

### efficiency-3 — Per-tag DAO deletes in conflict resolution

In `FirestoreSyncManager.handleRemoteArticleChange()` (lines 113–115), existing tags are deleted
one at a time:

```kotlin
val existingTags = articleDao.getArticleTags(remoteArticle.itemId)
existingTags.forEach { tag ->
    articleDao.deleteArticleTag(remoteArticle.itemId, tag)
}
```

`ArticleDao.deleteArticleTag(itemId, tag)` executes `DELETE FROM article_tags WHERE itemId=? AND
tag=?` — one SQL statement per tag. For an article with N tags, this is N DAO calls.

No existing bulk tag-delete method exists in `ArticleDao`. `@Delete(List)` is not applicable here
(the DAO uses string-tag entities, not entity-list deletes). The correct approach is a
`@Query("DELETE FROM article_tags WHERE itemId = :itemId") suspend fun
deleteAllTagsForArticle(itemId: String)` — a single SQL DELETE that removes all tags for an
article in one statement. Room executes this as a single auto-transactional call.

**Op reduction:** N DAO calls → 1 DAO call per article in the tag-replace path.

### efficiency-13 — Byte-heuristic for large-text split (ALREADY FIXED)

The scope note asked to confirm whether `FirestoreBackupService.kt` uses `text.length` (char count)
or `text.toByteArray().size` (byte count) for the >900KB inline-vs-subcollection decision.

**Finding:** Both sites in the current code already use `toByteArray().size`:
- `backupArticle()` line 171: `val textSize = article.text?.toByteArray()?.size ?: 0`
- `backupArticlesPaginated()` line 612: `val textSize = article.text?.toByteArray()?.size ?: 0`
- B1's `addArticleToBatch` extraction (as written in 04-plan-firestore-dedup.md Step 1) also
  uses `toByteArray().size`.

The efficiency-13 finding was triage-based and the fix is already present in the codebase.
**No code change is required for efficiency-13.** This is documented in ## Blockers.

## Reuse Opportunities

- **B1's `addArticleToBatch(batch, articleRef, article)`** — extend its signature to
  `addArticleToBatch(batch, articleRef, article, tags: List<ArticleTags> = emptyList())`.
  The existing two call sites in `backupArticle()` and `backupArticlesPaginated()` pass
  `emptyList()` (default). The chunk loop in `backupArticlesPaginated` passes fetched tags.
  `backupArticle` still handles its own tags separately (subcollection writes after the helper
  call) — no change to that path.

- **`getUserArticlesCollection(userId)`** — already a helper; the new `getUserMetaSnapshot()`
  follows the same pattern but reads the user doc, not the articles subcollection:
  ```kotlin
  private suspend fun getUserMetaSnapshot(userId: String) =
      firestore.collection(USERS_COLLECTION).document(userId).get().await()
  ```

- **`ArticleDao.deleteArticleTag(itemId, tag)`** stays for single-tag deletes; the new
  `deleteAllTagsForArticle(itemId)` is additive (no signature change to existing method).

## Likely Files / Areas to Touch

| File | Status | Role | Delta |
|---|---|---|---|
| `services/firestore/FirestoreBackupService.kt` | Modified | Add `getUserMetaSnapshot()`, extend `addArticleToBatch` signature, fold tag writes into chunk batch | +30 / -10 |
| `services/firestore/FirestoreSyncManager.kt` | Modified | Use single meta read, remove per-article tag-backup delegation after B2 changes commit pattern | +15 / -30 |
| `data/local/database/ArticleDao.kt` | Modified | Add `deleteAllTagsForArticle(itemId)` bulk-delete method | +7 / -0 |
| `services/firestore/FirestoreBackupServiceTest.kt` | Modified | Update chunk-batch characterization + add getUserMetaSnapshot single-read test | +40 / -5 |
| `services/firestore/FirestoreSyncManagerTest.kt` | Modified | Update tag-commit assertion; add deleteAllTagsForArticle call-count test | +15 / -8 |

**NOT touched:** `warg/`, `restoreAllArticlesPaginated` (streaming-restore owns it), tag reads on
restore path (`batched-tag-reads` owns it), article-repository bulk insert (`article-repository`
owns it).

## Proposed Change Strategy

Three independent efficiency fixes applied sequentially, each validated by the test suite.
Builds on B1's `addArticleToBatch` and `withAuthenticatedUser{}` helpers — hard prerequisite.
Hard cutover throughout (all in-app callers updated within this slice). No deprecation shims.

Sequence: test-net → streaming-restore → firestore-dedup (B1) → **firestore-io (B2)**.

## Step-by-Step Plan

**Step 1 — Add `getUserMetaSnapshot` to FirestoreBackupService**

Add a private helper:
```kotlin
private suspend fun getUserMetaSnapshot(userId: String) =
    firestore.collection(USERS_COLLECTION).document(userId).get().await()
```

Add a new public paired helper that reads once and returns both values:
```kotlin
data class UserMetaSnapshot(val isFirstSync: Boolean, val lastSyncTimestamp: Long?)

suspend fun getUserMetaSnapshot(): Result<UserMetaSnapshot> = withAuthenticatedUser { user ->
    val doc = getUserMetaDoc(user.uid)
    val hasTimestamp = doc.exists() && doc.contains("lastSyncTimestamp")
    val timestamp = doc.getLong("lastSyncTimestamp")
    Result.success(UserMetaSnapshot(isFirstSync = !hasTimestamp, lastSyncTimestamp = timestamp))
}
```

Keep `isFirstSync()` and `getLastSyncTimestamp()` in place — they are used by
`performFullSync()` independently and by tests. Do NOT delete them; callers that need both
values will use `getUserMetaSnapshot()` instead.

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"`
Expected: all existing tests green.

**Step 2 — Replace two-read pattern in syncLocalChanges and performFullSync**

In `FirestoreSyncManager.syncLocalChanges()`, replace:
```kotlin
val isFirstSync = firestoreBackupService.isFirstSync().getOrNull() ?: false
val lastSync = firestoreBackupService.getLastSyncTimestamp().getOrNull() ?: 0L
```
With:
```kotlin
val meta = firestoreBackupService.getUserMetaSnapshot().getOrNull()
val isFirstSync = meta?.isFirstSync ?: false
val lastSync = meta?.lastSyncTimestamp ?: 0L
```

In `FirestoreSyncManager.performFullSync()`, `isFirstSync()` is already called once (line 404)
with no paired `getLastSyncTimestamp()` call — leave it as-is (single read is already correct
there). Only `syncLocalChanges()` has the two-read pattern.

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreSyncManagerTest"`
Expected: characterization tests green; the test for sync meta reads must assert exactly 1
`users/{uid}` GET (updated from 2 to 1 in Step 6's test update).

**Step 3 — Extend `addArticleToBatch` to accept tags (FirestoreBackupService)**

Change the B1-extracted helper signature:
```kotlin
private fun addArticleToBatch(
    batch: WriteBatch,
    articleRef: DocumentReference,
    article: Article,
    tags: List<ArticleTags> = emptyList()
) {
    // existing large-text branch + batch.set(articleRef, articleToSave) ...
    // NEW: write tags into the same batch
    tags.forEach { tag ->
        val tagRef = articleRef.collection(TAGS_COLLECTION)
            .document("${tag.itemId}_${tag.tag}")
        batch.set(tagRef, tag, SetOptions.merge())
    }
}
```

The two existing call sites (`backupArticle()` and `backupArticlesPaginated()` article loop) pass
no `tags` argument — the default `emptyList()` preserves current behaviour. `backupArticle()`
still handles tag writes itself after calling `addArticleToBatch` (those writes go into its own
batch along with images, videos, etc.). No change to `backupArticle()`'s tag handling.

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"`
Expected: all existing tests green (tag writes via default emptyList() are no-ops).

**Step 4 — Fold tag-backup into `backupArticlesPaginated` chunk batch**

In `FirestoreBackupService.backupArticlesPaginated()`, inside the chunk loop, add a DAO call to
fetch tags per article and pass them to `addArticleToBatch`:

```kotlin
// NOTE: backupArticlesPaginated currently does not have DAO access.
// Tags must be passed in from the caller.
```

**Important:** `FirestoreBackupService` does not hold a reference to `ArticleDao`. Two options:

A) Add tags as a parameter: change `backupArticlesPaginated(articles, onProgress)` to
   `backupArticlesPaginated(articles, tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap(), onProgress)`.
   Caller (`syncLocalChanges`) pre-fetches tags for the chunk and passes the map.

B) Inject `ArticleDao` into `FirestoreBackupService`.

**Decision: Option A (pass tags in the call).** `FirestoreBackupService` is a Firestore-only
service; injecting Room DAO couples layers. The caller (`syncLocalChanges`) already has `articleDao`
and already fetches tags per-article. Change the signature to accept a `Map<String, List<ArticleTags>>`
parameter. Callers that don't need tag backup (e.g. `backupArticles()`) use the default `emptyMap()`.

Updated signature:
```kotlin
suspend fun backupArticlesPaginated(
    articles: List<Article>,
    tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap(),
    onProgress: (current: Int, total: Int) -> Unit = { _, _ -> }
): Result<Int>
```

Inside the chunk forEach:
```kotlin
val tags = tagsByArticleId[article.itemId] ?: emptyList()
addArticleToBatch(batch, articleRef, article, tags)
```

Hard cutover: update the call in `syncLocalChanges()` to pre-fetch tags for the chunk:
```kotlin
val chunkTagsMap = chunk.associate { article ->
    article.itemId to articleDao.getArticleTags(article.itemId).map { tag ->
        ArticleTags(itemId = article.itemId, tag = tag, sortId = null, type = null)
    }
}
val backupResult = firestoreBackupService.backupArticlesPaginated(
    articles = chunk,
    tagsByArticleId = chunkTagsMap,
    onProgress = { current, _ -> ... }
)
```

Remove the post-`backupArticlesPaginated` per-article `backupArticle` tag delegation that B1
introduced (that block no longer needed — tags are now in the chunk batch).

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreSyncManagerTest"`
Expected: updated tag-commit characterization test green.

**Step 5 — Add `deleteAllTagsForArticle` to ArticleDao**

Add to `ArticleDao`:
```kotlin
@Query("DELETE FROM article_tags WHERE itemId = :itemId")
suspend fun deleteAllTagsForArticle(itemId: String)
```

In `FirestoreSyncManager.handleRemoteArticleChange()`, replace:
```kotlin
val existingTags = articleDao.getArticleTags(remoteArticle.itemId)
existingTags.forEach { tag ->
    articleDao.deleteArticleTag(remoteArticle.itemId, tag)
}
```
With:
```kotlin
articleDao.deleteAllTagsForArticle(remoteArticle.itemId)
```

This is a hard cutover — only one call site. The `getArticleTags()` call is removed entirely
(the tag list was only needed to iterate for deletion; the bulk delete does not need it).

Run: `./gradlew :app:testDebugUnitTest`
Expected: full suite green.

**Step 6 — Update tests for all three efficiency changes**

In `FirestoreBackupServiceTest`:
- Add: `getUserMetaSnapshot reads users-uid doc exactly once for isFirstSync and lastSyncTimestamp`:
  mock `users/u1` doc with `lastSyncTimestamp = 1000L`; call `getUserMetaSnapshot()`; verify
  `firestore.collection("users").document("u1").get()` called exactly once; assert
  `result.getOrThrow().isFirstSync == false` and `result.getOrThrow().lastSyncTimestamp == 1000L`.
- Add: `getUserMetaSnapshot isFirstSync true when no timestamp`: mock doc with
  `contains("lastSyncTimestamp") = false`; assert `isFirstSync == true`.
- Update `backupArticlesPaginated chunks at WRITE_BATCH_LIMIT` test: pass a
  `tagsByArticleId` map; assert that `batch.set(tagRef, ...)` is called for tag docs within
  the same batch instance (not a new batch).

In `FirestoreSyncManagerTest`:
- Update B1's tag-backup characterization test: the new assertion is `firestore.batch()` called
  once per chunk (not once per article), and `backupArticlesPaginated` receives the pre-fetched
  `chunkTagsMap`. Comment: "B2 folds tag writes into the chunk batch; no separate per-article commit."
- Add: `handleRemoteArticleChange conflict resolution calls deleteAllTagsForArticle once`: mock
  a local article newer than remote → local kept, no update. Mock remote newer than local:
  verify `articleDao.deleteAllTagsForArticle(articleId)` called exactly once; verify
  `articleDao.deleteArticleTag` NOT called.

Run: `./gradlew :app:testDebugUnitTest`
Expected: full suite green including all updated and new tests.

**Step 7 — Efficiency-13 non-action: document fix-already-present**

Grep confirmed: both `backupArticle()` (line 171) and `backupArticlesPaginated()` (line 612) in
`FirestoreBackupService.kt` already use `article.text?.toByteArray()?.size ?: 0`. The B1-extracted
`addArticleToBatch` (04-plan-firestore-dedup.md Step 1) also uses `toByteArray().size`. No code
change required.

Add an inline comment at the `MAX_TEXT_SIZE` constant:
```kotlin
// MAX_TEXT_SIZE is compared against toByteArray().size (byte count), not text.length (char count).
// Firestore's 1 MiB doc limit is bytes; leaving 100KB buffer above 900KB for other fields.
private const val MAX_TEXT_SIZE = 900_000
```

This codifies the intent so future readers do not accidentally regress to `text.length`.

**Step 8 — Review checklist**
- [ ] `getUserMetaSnapshot()` data class and helper added to `FirestoreBackupService`.
- [ ] `syncLocalChanges()` uses exactly one Firestore GET for user-meta (not two).
- [ ] `addArticleToBatch` accepts `tags: List<ArticleTags> = emptyList()`.
- [ ] `backupArticlesPaginated` signature includes `tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap()`.
- [ ] Tags are written into the chunk batch via `addArticleToBatch` (not via a separate commit).
- [ ] The per-article `backupArticle` tag-delegation block from B1's Step 4 is removed.
- [ ] `ArticleDao.deleteAllTagsForArticle(itemId)` added.
- [ ] `handleRemoteArticleChange` uses single `deleteAllTagsForArticle` (no per-tag loop).
- [ ] `MAX_TEXT_SIZE` has inline comment confirming `toByteArray().size` intent.
- [ ] Full suite green: `./gradlew :app:testDebugUnitTest`.

**Step 9 — Run full test suite**
```
./gradlew :app:testDebugUnitTest
```
Expected: all tests pass. If any characterization test fails due to the tag-commit assertion
change, update it per Step 6 guidance before proceeding to review.

## Test / Verification Plan

**Named Gradle task (primary):**
```
./gradlew :app:testDebugUnitTest
```

Run after each step. Full suite at Step 5 and Step 9.

| After step | Test filter | Expected |
|---|---|---|
| Step 1 | `--tests "*.FirestoreBackupServiceTest"` | All existing tests green |
| Step 2 | `--tests "*.FirestoreSyncManagerTest"` | Characterization tests green |
| Step 3 | `--tests "*.FirestoreBackupServiceTest"` | All tests green (emptyList() default) |
| Step 4 | `--tests "*.FirestoreSyncManagerTest"` | Updated tag-commit assertion green |
| Step 5 | `./gradlew :app:testDebugUnitTest` | Full suite green |
| Step 6 | `./gradlew :app:testDebugUnitTest` | All new efficiency tests green |
| Step 9 | `./gradlew :app:testDebugUnitTest` | No regressions |

**Focused tests to add (efficiency assertions):**

| Test name | File | AC assertion |
|---|---|---|
| `getUserMetaSnapshot reads users doc exactly once` | `FirestoreBackupServiceTest` | `verify(exactly=1) { firestore.collection("users").document(uid).get() }` |
| `getUserMetaSnapshot isFirstSync true when no timestamp` | `FirestoreBackupServiceTest` | `result.isFirstSync == true` |
| `backupArticlesPaginated writes tags inside chunk batch` | `FirestoreBackupServiceTest` | `batch.set(tagRef,...)` called on same batch instance, no extra commit |
| `syncLocalChanges makes one meta read not two` | `FirestoreSyncManagerTest` | `verify(exactly=1) { fbs.getUserMetaSnapshot() }` |
| `handleRemoteArticleChange uses deleteAllTagsForArticle` | `FirestoreSyncManagerTest` | `verify(exactly=1) { articleDao.deleteAllTagsForArticle(id) }` |
| `handleRemoteArticleChange does not call deleteArticleTag` | `FirestoreSyncManagerTest` | `verify(exactly=0) { articleDao.deleteArticleTag(any(), any()) }` in update path |

**Characterization tests to update:**

| Test | Old assertion | New assertion |
|---|---|---|
| tag-backup N+1 (from B1 update) | `backupArticle() called N times` | `firestore.batch() called once per chunk` + `backupArticlesPaginated receives chunkTagsMap` |

## Risks / Watchouts

**MEDIUM — Chunk-batch tag inclusion and the rules document-access budget**
`WRITE_BATCH_LIMIT=20` was sized for one `getAfter(users/{uid}/articles/{itemId})` per article
(the marker create/update rule). Tag subcollection writes (`tags/{tagId}`) have no `getAfter`
check in the security rules — confirmed by reading the rules (marker rule only applies to the
`articleMarkers` collection path). Adding tag writes does not increase the doc-access count.
Confirm by running a batch with tags against the Firestore emulator if rules enforcement is
uncertain.

**MEDIUM — Tag-in-chunk-batch changes B1's characterization test assertion twice**
B1's Step 4 updated the assertion from "firestore.batch() called N times" to "backupArticle()
called N times". B2's Step 4 removes the `backupArticle` delegation and replaces it with
chunk-batch tag writes. The assertion must be updated again to "firestore.batch() called once
per chunk". This is expected coordination; include a comment in the test referencing this plan.

**LOW — `getUserMetaSnapshot` data class needs a stable name/location**
If `UserMetaSnapshot` is a nested data class inside `FirestoreBackupService`, it is accessible
from `FirestoreSyncManager` (same package). If it must cross packages, promote to top-level
in the `services/firestore` package. Either is fine; keep it package-private.

**LOW — `deleteAllTagsForArticle` window between delete and insert**
The delete of all tags followed by `insertArticleTags(tags)` is not wrapped in a Room
`@Transaction`. There is a brief window where article has no tags. This matches the current
per-tag-delete + insert pattern (same window, shorter in practice). The sync path is
background-only and not user-visible. Acceptable; document in KDoc.

## Dependencies on Other Slices

| Slice | Direction | What this slice assumes |
|---|---|---|
| `test-net` | prerequisite (hard) | `FirestoreBackupServiceTest` and `FirestoreSyncManagerTest` characterization suites green |
| `streaming-restore` | prerequisite (soft) | `restoreAllArticlesPaginated` uses `onPage` callback; not directly in scope here |
| `firestore-dedup` (B1) | prerequisite (HARD) | `addArticleToBatch` helper extracted; `withAuthenticatedUser{}` in place; tag-backup delegated to `backupArticle` in `syncLocalChanges`. B2 builds on these — must land AFTER B1 |
| `batched-tag-reads` (A3) | downstream | Modifies `applyRemoteArticles` body — different function surface; no conflict |
| `article-repository` (B3) | downstream | Bulk DAO insert in `ArticleRepository.add()` — different file; no conflict |

**CROSS-SLICE OWNERSHIP TABLE (updated for B2):**

| Surface | Owner |
|---|---|
| `addArticleToBatch` signature extension (tags param) | This slice (B2) |
| `backupArticlesPaginated` tag-bypass in syncLocalChanges | This slice (B2); B1 sets it up, B2 replaces delegation with chunk-batch inclusion |
| `getUserMetaSnapshot()` / `UserMetaSnapshot` data class | This slice (B2) |
| `deleteAllTagsForArticle` DAO method | This slice (B2) |
| `applyRemoteArticles` signature | `batched-tag-reads` — do not touch here |
| `restoreAllArticlesPaginated` signature | `streaming-restore` — do not touch here |
| `@ApplicationScope` scope injection | `app-scope` — do not touch here |

## Assumptions

1. B1 (`firestore-dedup`) has landed before this slice is implemented. If not, B2 cannot build
   on `addArticleToBatch` — it does not exist yet. Hard prerequisite.
2. `backupArticlesPaginated` is the only path in `syncLocalChanges` that writes articles to
   Firestore in chunks. `backupArticles()` (non-paginated) exists but is not called from the
   sync path. Confirmed by reading `FirestoreSyncManager.kt`.
3. `FirestoreBackupService` does not hold `ArticleDao`. Confirmed: constructor only injects
   `FirebaseFirestore` and `FirebaseAuth`. Tag pre-fetch must stay in the caller.
4. `Article.itemId` is the key for tag lookup — matches the existing `getArticleTags(itemId)`
   DAO call. No change to key structure needed.
5. The tag subcollection in Firestore uses `${tag.itemId}_${tag.tag}` as the doc ID. This
   is the same format used in `backupArticle()` and in the B1-extracted pattern. Confirmed.
6. Room 2.8.0 is in use (confirmed in `libs.versions.toml`). `@Query` suspend functions are
   auto-transactional for single-statement operations like `DELETE … WHERE itemId=?`.

## Blockers

**efficiency-13 — fix already present (no action required):**
The scope directive asked to confirm whether `FirestoreBackupService.kt` uses `text.length`
(char count, incorrect) or `text.toByteArray().size` (byte count, correct) for the
`MAX_TEXT_SIZE` comparison.

Code inspection of both sites:
- `backupArticle()` line 171: `val textSize = article.text?.toByteArray()?.size ?: 0` — CORRECT
- `backupArticlesPaginated()` line 612: `val textSize = article.text?.toByteArray()?.size ?: 0` — CORRECT
- B1's `addArticleToBatch` extraction (plan Step 1) also uses `toByteArray().size` — CORRECT

The `text.length` bug described in the triage (and under B8 in the shape) is **not present** in
the current backup path. The fix is already in the code. No code change is made for efficiency-13
beyond the clarifying comment on `MAX_TEXT_SIZE` (Step 7). This is NOT a blocker for
implementation — it is a finding that one of the four efficiency items is pre-fixed.

## Freshness Research

Carried from `02-shape.md` § Freshness Research — no new external research required:

> **WriteBatch (efficiency-2)** — "The 500-doc/batch hard limit is gone; real cap is 10 MiB/commit
> + 270s txn. Keep ~500 chunks for throughput hygiene." `WRITE_BATCH_LIMIT=20` is sized for the
> Firestore rules document-access budget (20 `getAfter()` calls per batched write), not the byte
> cap. Tag writes are subcollection docs with no rules `getAfter()` — adding them does not
> threaten the rules budget. The 10 MiB cap is the absolute ceiling; a chunk of 20 articles with
> tags is well below it.

> **Room 2.8.0 (efficiency-3)** — "`@Insert(List)`/`@Delete(List)` are auto-transactional; use
> `@Transaction`/`withTransaction {}` only for multi-op atomicity; `DELETE … WHERE parentId` for
> cascade deletes. KSP (not kapt) on Kotlin 2.x." The new `deleteAllTagsForArticle(itemId)` uses
> `@Query` not `@Delete(List)` — it is a single SQL DELETE statement, auto-transactional. No
> `@Transaction` annotation needed. Room KSP on Kotlin 2.x: confirmed in `libs.versions.toml`
> (`ksp = "2.1.20-1.0.32"`).

## Revision History

_(efficiency-13 reassigned from B8 to this slice by the planning prompt. On code inspection,
the fix was found to be already present. Step 7 adds a clarifying comment only.)_

## Recommended Next Stage

`/wf implement simplify-android-app firestore-io`

Prerequisites (hard gates):
- `test-net` implemented and green (characterization baseline exists).
- `app-scope` implemented (injected scope in `FirestoreSyncManager`).
- `streaming-restore` implemented (`restoreAllArticlesPaginated` uses `onPage` callback).
- `firestore-dedup` (B1) implemented and green (`addArticleToBatch` and `withAuthenticatedUser{}`
  exist; tag-backup delegation to `backupArticle` in `syncLocalChanges` in place).

Implement in order: Steps 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (review) → 9 (full test run).
