---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: firestore-dedup
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 11
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, firestore, dedup, reuse]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-firestore-dedup.md
  siblings:
    - 03-slice-test-net.md
    - 03-slice-app-scope.md
    - 03-slice-firestore-io.md
  implement: 05-implement-firestore-dedup.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app firestore-dedup"
---

# Plan: Firestore sync/backup deduplication (B1)

## Current State

### FirestoreBackupService.kt (644 lines)

`FirestoreBackupService` is the single-file Firestore persistence layer. Its `companion object`
(lines 29–47) defines 11 collection-name constants and two numeric limits. It already provides:

- `getCurrentUser()` / `getUserArticlesCollection()` / `getUserMarkersCollection()` — auth + path
  helpers (private, lines 52–75).
- `backupArticle(article, tags, images, …)` — the canonical single-article backup: large-text
  branching, batch writes for all subcollections, marker writes, single `batch.commit()`.
- `backupArticlesPaginated(articles, onProgress)` — chunked write (WRITE_BATCH_LIMIT=20) of
  articles + markers; no tags written here.
- `restoreAllArticlesPaginated(onProgress)` — **post-streaming-restore signature** will be
  `suspend fun restoreAllArticlesPaginated(onProgress, onPage): Result<Unit>`.
- `restoreArticleTags(articleId)` — single-article tag read.

**Duplication sites in this file (already canonical — these are the single sources):**
- Collection constants: ONLY here.
- `addArticleToBatch`: does NOT yet exist as a helper — the large-text branching + `batch.set(articleRef, …)` block is inlined in both `backupArticle()` and `backupArticlesPaginated()`.

### FirestoreSyncManager.kt (537 lines)

`FirestoreSyncManager` orchestrates the sync loop. Post-`app-scope` (prerequisite), its
`@ApplicationScope CoroutineScope` is injected; `cleanup()` no longer cancels the scope.

**Duplication and quality findings mapped to exact sites:**

**reuse-1 / quality-3 — Collection-name constants duplicated:**
`FirestoreSyncManager.companion object` (lines 71–75) declares:
```kotlin
private const val USERS_COLLECTION = "users"
private const val ARTICLES_COLLECTION = "articles"
private const val SYNC_WORK_NAME = "FirestoreBidirectionalSync"
```
`USERS_COLLECTION` and `ARTICLES_COLLECTION` duplicate `FirestoreBackupService.companion`. They are
referenced in the tag-backup inline block (lines 300–309) and nowhere else (after the inline block
is removed by reuse-2/3, they become dead). `SYNC_WORK_NAME` is local and stays.

**reuse-2 — Inline auth guard duplicated:**
Two inline auth guards in `FirestoreSyncManager`:
- `syncLocalChanges()` lines 208–212: `val user = auth.currentUser; if (user == null) { …return }`
- `performFullSync()` lines 392–396: same pattern.

`FirestoreBackupService` has the same pattern repeated 10+ times inside each method. A private
`withAuthenticatedUser { }` helper collapses all of them:
```kotlin
private suspend inline fun <T> withAuthenticatedUser(
    block: suspend (user: FirebaseUser) -> Result<T>
): Result<T> {
    val user = getCurrentUser()
        ?: return Result.failure(Exception("User not authenticated"))
    return block(user)
}
```
For `FirestoreSyncManager`, the auth guard pattern returns early (not `Result.failure`) — this is
an **intentionally distinct path** (see Intentionally-Distinct Paths below). The helper applies
only to `FirestoreBackupService`; `FirestoreSyncManager` keeps its early-return guard unchanged.

**reuse-3 — `addArticleToBatch` extraction:**
The large-text-branching + `batch.set(articleRef, articleToSave)` sequence is inlined in:
- `backupArticle()` (lines 170–188)
- `backupArticlesPaginated()` (lines 611–622)

Extract to a private `fun addArticleToBatch(batch, articleRef, article)` in
`FirestoreBackupService`. Both call sites delegate to it. This is the helper that `firestore-io`
(B2) will later extend with per-chunk commit logic — **sequence B1 before B2**.

**reuse-4 — `applyRemoteArticles` helper extraction:**
Two duplicated `fold+chunked(50)+forEach { handleRemoteArticleChange(it) }` blocks:
- `performFullSync()` Scenario 2 (lines 434–452): processes `remoteArticles` from restore.
- `performBidirectionalSync()` (lines 499–514): same pattern.

Note: **post-`streaming-restore`**, both call sites already use the `onPage` callback shape — the
`fold+chunked(50)` pattern is replaced by the streaming `onPage` lambda. What remains duplicated
is the `onPage` lambda body itself: `withContext(IO) { pageArticles.forEach { handleRemoteArticleChange(it) } }`.

Extract this to `private suspend fun applyRemoteArticles(articles: List<Article>)`. Both `onPage`
lambdas delegate to it. **This is the definitive helper that `batched-tag-reads` plugs
`batchRestoreArticleTags` into** — do not change `applyRemoteArticles`' signature further.

**reuse-7 — Tag-backup delegated to `backupArticle`:**
`syncLocalChanges()` (lines 286–317): after `backupArticlesPaginated` succeeds for a chunk, a
separate per-article inline tag-backup loop fires a raw `firestore.batch()` per article, writing
tags to `users/{uid}/articles/{id}/tags/` using hard-coded string collection paths.

`backupArticle()` already writes tags (+ images, authors, markers) in one batch. Delegating the
tag-backup to `backupArticle` replaces the N per-article raw batches with N calls to the canonical
backup path. The characterization test for the N+1 quirk must be updated: the assertion changes
from "firestore.batch() called N times" to "backupArticle() called N times" — behaviour is
preserved (one Firestore commit per article) while the duplication is removed.

**Intentionally-distinct paths NOT merged:**
- `FirestoreSyncManager.syncLocalChanges()` and `performFullSync()` auth guards return early with
  `_syncStatus.value = SyncStatus.Error(...)` — NOT `Result.failure(...)`. This is intentionally
  distinct from `FirestoreBackupService`'s `Result.failure` pattern. Do NOT unify.
- `pushLocalArticle()` builds `ArticleTags` from DAO strings then calls `backupArticle()` — this
  already delegates correctly; no change needed.
- `handleRemoteArticleChange()` internal tag-restore calls `restoreArticleTags()` (single-article)
  — this is the correct pre-`batched-tag-reads` path; do not change here.

## Reuse Opportunities

| Finding | Duplication sites | Extraction target | Notes |
|---|---|---|---|
| reuse-1/quality-3 | `FSM.companion: USERS_COLLECTION, ARTICLES_COLLECTION` | Delete after inline usage removed | `SYNC_WORK_NAME` stays in FSM |
| reuse-2 | Auth-guard in every `FBS` method | Private `withAuthenticatedUser{}` in `FBS` only | FSM guards are intentionally distinct |
| reuse-3 | Large-text branch in `backupArticle` + `backupArticlesPaginated` | `FBS.addArticleToBatch(batch, articleRef, article)` | B2 (firestore-io) adds per-chunk commit on top |
| reuse-4 | Duplicated `onPage` lambda in `performFullSync` + `performBidirectionalSync` | `FSM.applyRemoteArticles(articles)` | batched-tag-reads plugs in here |
| reuse-7 | Inline per-article tag batch in `syncLocalChanges` | Delegate to `FBS.backupArticle()` | Changes batch-count characterization assertion |

## Likely Files / Areas to Touch

| File | Status | Role |
|---|---|---|
| `services/firestore/FirestoreBackupService.kt` | Modified | Add `withAuthenticatedUser`, extract `addArticleToBatch`, widen companion visibility |
| `services/firestore/FirestoreSyncManager.kt` | Modified | Delete duplicate constants, extract `applyRemoteArticles`, delegate tag-backup to `backupArticle` |
| `services/firestore/FirestoreBackupServiceTest.kt` | Modified | Re-run after each step; no new behaviour tests |
| `services/firestore/FirestoreSyncManagerTest.kt` | Modified | Update tag-backup N+1 characterization assertion; verify compile after signature changes |

## Proposed Change Strategy

Five discrete extraction steps, each followed by a test run. Hard cutover throughout — all in-app
callers updated within this slice. No deprecation shims. Sequence: B1 (this slice) before B2
(`firestore-io`) — B2's per-chunk commit logic builds on `addArticleToBatch`.

The plan assumes **post-`app-scope`** code (injected scope, neutered `cleanup()`) and
**post-`streaming-restore`** code (`restoreAllArticlesPaginated` uses `onPage` callback,
returns `Result<Unit>`).

## Step-by-Step Plan

**Step 1 — Extract `addArticleToBatch` in FirestoreBackupService**

Add to `FirestoreBackupService` (private):
```kotlin
private fun addArticleToBatch(
    batch: WriteBatch,
    articleRef: DocumentReference,
    article: Article
) {
    val textSize = article.text?.toByteArray()?.size ?: 0
    val articleToSave = if (textSize > MAX_TEXT_SIZE && article.text != null) {
        val textRef = articleRef.collection(ARTICLE_TEXT_COLLECTION).document("content")
        batch.set(textRef, mapOf("text" to article.text), SetOptions.merge())
        article.copy(text = null)
    } else {
        article
    }
    batch.set(articleRef, articleToSave, SetOptions.merge())
}
```

Replace the inlined large-text block in `backupArticle()` (lines 170–188) with:
```kotlin
addArticleToBatch(batch, articleRef, article)
val articleToSave = /* removed — addArticleToBatch handles it */
```
Note: `backupArticle` still adds tags, images, etc. after the article write. Only the article doc
write + text branch moves into the helper.

Replace the inlined large-text block in `backupArticlesPaginated()` (lines 611–622):
```kotlin
chunk.forEach { article ->
    val articleRef = getUserArticlesCollection(user.uid).document(article.itemId)
    addArticleToBatch(batch, articleRef, article)
    addMarkerWrites(batch, user.uid, article)
}
```

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"`
Expected: all existing 8 tests green.

**Step 2 — Add `withAuthenticatedUser` helper in FirestoreBackupService**

Add (private inline) to `FirestoreBackupService`:
```kotlin
private suspend inline fun <T> withAuthenticatedUser(
    block: suspend (user: FirebaseUser) -> Result<T>
): Result<T> {
    val user = getCurrentUser()
        ?: return Result.failure(Exception("User not authenticated"))
    return block(user)
}
```

Replace inline auth guards in `FirestoreBackupService` methods. Each method currently has:
```kotlin
val user = getCurrentUser() ?: return Result.failure(Exception("User not authenticated"))
```
This is the identical 2-line guard repeated in: `writeArticleMarker`, `backupArticle`,
`backupArticles`, `restoreArticle`, `restoreAllArticlesPaginated`, `restoreArticleTags`,
`restoreArticleImages`, `deleteArticle`, `getLastSyncTimestamp`, `updateLastSyncTimestamp`,
`isFirstSync`, `getRemoteArticleCount`, `backupArticlesPaginated`.

Replace each with `return withAuthenticatedUser { user -> … }` wrapping the function body. The
`return` type becomes inferred from the block return. The `user` variable is passed in — no
semantic change.

**Do NOT apply this helper to `FirestoreSyncManager`** — its guards return early with
`_syncStatus.value = SyncStatus.Error(...)`, which is not a `Result<T>` return.

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreBackupServiceTest"`
Expected: all 8 existing tests green.

**Step 3 — Delete duplicate constants from FirestoreSyncManager**

In `FirestoreSyncManager.companion object`, delete:
```kotlin
private const val USERS_COLLECTION = "users"
private const val ARTICLES_COLLECTION = "articles"
```
Keep `SYNC_WORK_NAME`.

These constants are referenced in the inline tag-backup block (lines ~300–309). Step 4 removes
that block, so delete constants AFTER Step 4 completes OR verify the inline block is the only
usage before deleting (grep confirms: both constants appear only in lines 300–309 after Step 4
removes that block). Safe to delete in this step if Step 4 immediately follows.

Remove the now-unused imports of `com.google.firebase.firestore.SetOptions` from
`FirestoreSyncManager` (if no other usage remains after Step 4).

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreSyncManagerTest"`
Expected: characterization tests green.

**Step 4 — Delegate tag-backup to `backupArticle` in syncLocalChanges**

In `syncLocalChanges()` (post-`app-scope` code), inside `backupResult.fold { onSuccess = { count -> … } }`:

Current inline per-article tag-backup block (lines ~288–316):
```kotlin
chunk.forEach { article ->
    try {
        val tags = articleDao.getArticleTags(article.itemId).map { tag ->
            ArticleTags(itemId = article.itemId, tag = tag, sortId = null, type = null)
        }
        if (tags.isNotEmpty()) {
            val currentUser = auth.currentUser ?: return@forEach
            val articleRef = firestore.collection("users")
                .document(currentUser.uid)
                .collection("articles")
                .document(article.itemId)
            val batch = firestore.batch()
            tags.forEach { tag ->
                val tagRef = articleRef.collection("tags").document("${tag.itemId}_${tag.tag}")
                batch.set(tagRef, tag, SetOptions.merge())
            }
            batch.commit().await()
        }
    } catch (e: Exception) {
        Timber.w(e, "Failed to backup tags for article ${article.itemId}")
    }
}
```

Replace with:
```kotlin
chunk.forEach { article ->
    try {
        val tags = articleDao.getArticleTags(article.itemId).map { tag ->
            ArticleTags(itemId = article.itemId, tag = tag, sortId = null, type = null)
        }
        firestoreBackupService.backupArticle(
            article = article,
            tags = tags,
            images = emptyList(),
            videos = emptyList(),
            authors = emptyList(),
            domainMetadata = null
        ).onFailure { e ->
            Timber.w(e as? Exception, "Failed to backup article ${article.itemId} with tags")
        }
    } catch (e: Exception) {
        Timber.w(e, "Failed to backup tags for article ${article.itemId}")
    }
}
```

Note: `backupArticle` also re-writes the article doc itself (idempotent via `SetOptions.merge()`).
This is a minor write-count increase per article but behaviour-preserving (idempotent upsert) and
the article was already written by `backupArticlesPaginated` in the step above.

Update `FirestoreSyncManagerTest` characterization test for the tag-backup N+1 quirk:
- Old assertion: `verify { firestore.batch() called exactly N times (one per article tag-batch) }`
- New assertion: `verify { firestoreBackupService.backupArticle(...) called exactly N times }`
- Update inline comment: "firestore-dedup delegated to backupArticle; firestore-io (B2) will
  address the residual per-article commit count."

Run: `./gradlew :app:testDebugUnitTest --tests "*.FirestoreSyncManagerTest"`
Expected: updated characterization test green.

**Step 5 — Extract `applyRemoteArticles` helper in FirestoreSyncManager**

Post-`streaming-restore`, the `onPage` lambda body in both call sites is:
```kotlin
onPage = { pageArticles ->
    withContext(Dispatchers.IO) {
        pageArticles.forEach { handleRemoteArticleChange(it) }
    }
}
```

Extract to a private suspend function:
```kotlin
private suspend fun applyRemoteArticles(articles: List<Article>) {
    withContext(Dispatchers.IO) {
        articles.forEach { handleRemoteArticleChange(it) }
    }
}
```

Replace both `onPage` lambda bodies:
```kotlin
onPage = { pageArticles -> applyRemoteArticles(pageArticles) }
```

**Call site 1** — `performFullSync()` Scenario 2 (~line 428):
```kotlin
firestoreBackupService.restoreAllArticlesPaginated(
    onProgress = { current, total ->
        _syncStatus.value = SyncStatus.Syncing
        Timber.d("Restoring $current / $total articles")
    },
    onPage = { pageArticles -> applyRemoteArticles(pageArticles) }
).onFailure { throw it }
_syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")
```

**Call site 2** — `performBidirectionalSync()` (~line 492):
```kotlin
firestoreBackupService.restoreAllArticlesPaginated(
    onProgress = { current, total ->
        _syncStatus.value = SyncStatus.Syncing
        Timber.d("Restoring $current / $total articles")
    },
    onPage = { pageArticles -> applyRemoteArticles(pageArticles) }
).onFailure { throw it }
```

Note: `batched-tag-reads` (A3) will modify `applyRemoteArticles` to call `batchRestoreArticleTags`
and pass prefetched tags to `handleRemoteArticleChange`. Do NOT change `applyRemoteArticles`
further here — leave it as the single extension point.

Run: `./gradlew :app:testDebugUnitTest`
Expected: full unit test suite green.

**Step 6 — Remove unused imports from FirestoreSyncManager**

After Steps 3–5, the following imports may be unused in `FirestoreSyncManager.kt`:
- `com.google.firebase.firestore.SetOptions` (used in the deleted inline tag-batch)
- `kotlinx.coroutines.SupervisorJob` (removed by `app-scope` prerequisite)
- `kotlinx.coroutines.cancel` (removed by `app-scope` prerequisite)

Remove any now-unused imports. The Kotlin compiler will flag remaining unused imports as warnings;
IDE unused-import inspection confirms the list.

Run: `./gradlew :app:testDebugUnitTest`
Expected: no regressions.

**Step 7 — Review checklist**
- [ ] `FirestoreSyncManager.companion` no longer declares `USERS_COLLECTION` or
  `ARTICLES_COLLECTION`.
- [ ] No raw `firestore.collection("users")` string literals remain in `FirestoreSyncManager`
  (all paths go through `FirestoreBackupService` helpers).
- [ ] `withAuthenticatedUser{}` is applied to all `FirestoreBackupService` methods (13 sites).
- [ ] `addArticleToBatch` is called by both `backupArticle` and `backupArticlesPaginated`.
- [ ] `applyRemoteArticles` is called from exactly two `onPage` lambda sites.
- [ ] Tag-backup in `syncLocalChanges` delegates to `backupArticle`.
- [ ] `FirestoreSyncManagerTest` tag-N+1 characterization test updated and green.
- [ ] Full suite green: `./gradlew :app:testDebugUnitTest`.

## Test / Verification Plan

**Named Gradle task (primary):**
```
./gradlew :app:testDebugUnitTest
```

Run after EACH extraction step (Steps 1–6). The test-net characterization suite is the parity
proof — staying green is the only automated criterion for this behaviour-preserving slice.

| After step | Test filter | Expected |
|---|---|---|
| Step 1 | `--tests "*.FirestoreBackupServiceTest"` | All 8 existing tests green |
| Step 2 | `--tests "*.FirestoreBackupServiceTest"` | All 8 tests green |
| Step 3 | `--tests "*.FirestoreSyncManagerTest"` | Characterization tests green |
| Step 4 | `--tests "*.FirestoreSyncManagerTest"` | Updated tag-N+1 assertion green |
| Step 5 | `./gradlew :app:testDebugUnitTest` (full) | Full suite green |
| Step 6 | `./gradlew :app:testDebugUnitTest` (full) | No regressions |

No new behaviour tests are written in this slice. The characterization suite from `test-net` is
the parity proof. Structure changes, behaviour identical.

## Risks / Watchouts

**HIGH — Over-eager dedup: tag-backup inline vs `backupArticle` differ in write scope**
The inline tag-batch in `syncLocalChanges` writes ONLY tags. `backupArticle()` writes the article
doc + large-text branch + all related subcollections + markers in one batch. Delegating to
`backupArticle` re-writes the article doc (idempotent) and adds marker writes (additive). This is
not a behaviour regression but it DOES change the Firestore write pattern (more bytes per article
in the tag-backup path). The characterization test must be updated to assert the new pattern (see
Step 4). Verify no test asserts the absence of a re-write before delegating.

**MEDIUM — Constant deletion order**
`USERS_COLLECTION` and `ARTICLES_COLLECTION` in `FirestoreSyncManager.companion` must be deleted
AFTER the inline tag-backup block is gone (Step 4). Deleting before Step 4 will break compilation.
Sequence Steps 3 and 4 in order, or do Step 4 first and Step 3 as cleanup.

**LOW — `withAuthenticatedUser` inline keyword**
`inline` is required because the block is a `suspend` lambda. If the Kotlin compiler rejects
`inline suspend fun`, use a non-inline `suspend fun` accepting a `suspend (FirebaseUser) -> Result<T>`
parameter. Behaviour is identical; the `inline` just avoids the extra function object.

**LOW — `applyRemoteArticles` is the `batched-tag-reads` extension point**
The `batched-tag-reads` plan (A3) will replace `applyRemoteArticles` body with batch-prefetch +
`handleRemoteArticleChange(article, prefetchedTags)`. Do not add logic to `applyRemoteArticles`
beyond the minimal extraction here.

## Dependencies on Other Slices

| Slice | Direction | What this slice assumes |
|---|---|---|
| `test-net` | prerequisite (hard) | `FirestoreSyncManagerTest` and `FirestoreBackupServiceTest` characterization suite is green — that is the parity proof |
| `app-scope` | prerequisite (hard) | `FirestoreSyncManager` already has injected `@ApplicationScope` scope; `cleanup()` already neutered; `scope.cancel()` already gone |
| `streaming-restore` | prerequisite (soft, assumed landed) | `restoreAllArticlesPaginated` already uses `onPage` callback + returns `Result<Unit>`; this slice's `applyRemoteArticles` extraction slots into the streaming shape |
| `batched-tag-reads` | downstream | Adds `batchRestoreArticleTags` + modifies `applyRemoteArticles` body — must land AFTER this slice |
| `firestore-io` | downstream | Extends `addArticleToBatch` with per-chunk commit — must land AFTER this slice |

**CROSS-SLICE OWNERSHIP TABLE:**

| Surface | Owner |
|---|---|
| `@ApplicationScope` scope injection in `FirestoreSyncManager` | `app-scope` — do not re-touch |
| `restoreAllArticlesPaginated` signature (`onPage` callback, `Result<Unit>`) | `streaming-restore` — do not re-touch |
| `batchRestoreArticleTags` method + `handleRemoteArticleChange(article, prefetchedTags)` signature | `batched-tag-reads` — lands after this slice |
| `addArticleToBatch` helper (extracted here) | This slice; B2 (`firestore-io`) extends |
| `applyRemoteArticles` helper (extracted here) | This slice; `batched-tag-reads` modifies body |
| Tag-backup delegation to `backupArticle` | This slice |
| Per-chunk commit batching + bulk tag-delete DAO | `firestore-io` (B2) — out of scope here |

## Assumptions

1. `streaming-restore` has landed before this slice is implemented. If not, `applyRemoteArticles`
   extracts the old `fold+chunked(50)` body (not the `onPage` lambda) — still the same extraction
   principle; the test-net suite pinned the old shape and the streaming-restore update is a
   coordinated rebase.
2. `addArticleToBatch` extraction in `backupArticle` does not need to return the `articleToSave`
   reference (the tags/images/etc. writes that follow use `articleRef` subcollections, not the
   article object). Confirmed by reading the method body: post-article-write, the code uses
   `articleRef.collection(TAGS_COLLECTION)` etc. — no dependency on `articleToSave`.
3. `FirestoreSyncManager` has no in-app callers of `USERS_COLLECTION` / `ARTICLES_COLLECTION`
   beyond the inline tag-batch block. Confirmed by reading the file — both constants appear only
   at lines 301 and 308.
4. `backupArticle` is idempotent (uses `SetOptions.merge()`). Re-writing the article doc in the
   tag-backup delegation path adds a Firestore write but no semantic change.
5. The `FirestoreSyncManagerTest` characterization file created by `test-net` will have the tag-N+1
   assertion available to update. If `test-net` has not yet landed, this step is deferred until
   the test file exists.

## Blockers

None. All decisions resolved by static code analysis. No external API decisions pending. No deploy
gating.

## Freshness Research

Carried from `02-shape.md` § Freshness Research — no new external research required for this
behaviour-preserving structural slice:

> **WriteBatch** — 10 MiB/commit + 270s txn hard limit (500-doc soft guideline for throughput).
> `backupArticle` commits one batch per article; this is the N-commit pattern `firestore-io` (B2)
> will replace with per-chunk commits. This slice does not change commit frequency.

> **SetOptions.merge()** — idempotent partial update; re-writing an article doc that already exists
> is safe and correct (confirmed Firestore partial-update behaviour).

> **Kotlin `inline` + `suspend` lambda** — `inline suspend fun` accepting a `suspend () -> T` block
> is valid in Kotlin 2.x and avoids the suspend-lambda object allocation. No coroutine library
> change needed.

## Revision History

_(empty — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app firestore-dedup`

Prerequisites:
- `test-net` slice implemented and green (hard gate — characterization suite must exist).
- `app-scope` slice implemented and green (hard gate — injected scope, neutered `cleanup()`).
- `streaming-restore` recommended (soft — if not landed, Steps 5/6 extract the old fold+chunked
  body; rebase when streaming-restore lands).

Implement in order: Steps 1 → 2 → 4 → 3 → 5 → 6 → 7 (Step 3 / constant deletion after Step 4
removes the only usages).
