# Firestore sync/backup architecture

The Android client maintains a bidirectional sync between its local Room database
and a per-user Firestore namespace. This document explains the shape of that layer,
where the key pieces live, and why they are structured the way they are. Audience:
a developer who needs to touch the sync or backup path.

---

## Overview

Every authenticated user gets a private subtree rooted at `users/{uid}/`. Articles,
tags, images, videos, authors, and large-text overflows all live in subcollections
of that subtree. Sync is handled by two collaborating classes:

- **`FirestoreBackupService`** (`services/firestore/FirestoreBackupService.kt`) —
  the data layer. Owns all Firestore reads and writes. Exposed as a `@Singleton`
  injected via Hilt.
- **`FirestoreSyncManager`** (`services/firestore/FirestoreSyncManager.kt`) —
  the orchestration layer. Decides when to backup vs restore, tracks sync state,
  schedules periodic WorkManager syncs.

---

## Collection layout

All paths below are relative to `users/{uid}/`.

| Constant (in `FirestoreBackupService.companion`) | Firestore path segment | Purpose |
|---|---|---|
| `USERS_COLLECTION = "users"` | `users/{uid}` | User document (holds `lastSyncTimestamp`) |
| `ARTICLES_COLLECTION = "articles"` | `articles/{itemId}` | Article documents |
| `TAGS_COLLECTION = "tags"` | `articles/{itemId}/tags/{itemId}_{tag}` | Tag subcollection |
| `IMAGES_COLLECTION = "images"` | `articles/{itemId}/images/{rowDocId(imageId)}` | Image subcollection |
| `VIDEOS_COLLECTION = "videos"` | `articles/{itemId}/videos/{rowDocId(videoId)}` | Video subcollection |
| `AUTHORS_COLLECTION = "authors"` | `articles/{itemId}/authors/{rowDocId(authorId)}` | Author subcollection |
| `DOMAIN_METADATA_COLLECTION = "domain_metadata"` | `articles/{itemId}/domain_metadata/metadata` | Domain metadata |
| `ARTICLE_TEXT_COLLECTION = "text"` | `articles/{itemId}/text/content` | Large-text overflow store |

The string literals for all collection names live exclusively in
`FirestoreBackupService.companion`. No other class constructs these path strings —
they are composed via private helpers (`getUserArticlesCollection`, etc.).

Row documents (images, authors, videos) are keyed by `rowDocId(id)` from
`ArticleRowsCodec`: the row id URL-encoded, with `.`, `..` and `__x__` escaped, so an
id such as the `<itemId>:byline` author id is a valid document id. Restore reads the
row id from the document's data, not from its id.

The app writes no existence markers. The `users/{uid}/articleMarkers/{key}` documents
that gate the shared-article read rule are written by the server; see
[`shared-types/MarkerSchema.md`](../../shared-types/MarkerSchema.md).

---

## Authentication guard

`FirestoreBackupService` uses a private inline helper:

```kotlin
private suspend fun <T> withAuthenticatedUser(
    block: suspend (user: FirebaseUser) -> Result<T>
): Result<T>
```

Every public method on `FirestoreBackupService` is wrapped in this guard. If no
user is authenticated it returns `Result.failure(Exception("User not authenticated"))`
immediately, without touching Firestore.

`FirestoreSyncManager` uses an intentionally distinct early-return pattern:
```kotlin
val user = auth.currentUser
if (user == null) {
    _syncStatus.value = SyncStatus.Error("Not authenticated", null)
    return
}
```

These are **not unified** and should **not be unified**. `FirestoreBackupService`
returns `Result<T>` values for programmatic error handling; `FirestoreSyncManager`
drives a `StateFlow<SyncStatus>` for UI display. Merging them would mix UI
concerns into the data layer.

---

## Write path

### `addArticleToBatch`

```kotlin
private fun addArticleToBatch(
    batch: WriteBatch,
    articleRef: DocumentReference,
    article: Article,
    tags: List<ArticleTags> = emptyList()
)
```

The single source for writing an article (and optionally its tags) onto a
`WriteBatch`. The large-text branch:

- If `article.text?.toByteArray()?.size` exceeds `MAX_TEXT_SIZE = 900_000` bytes,
  the text is stored in the `text/content` subcollection and the article doc is
  saved with `text = null`.
- Otherwise, the text stays inline.

The byte-count check uses `toByteArray().size`, not `text.length`, because
Firestore's document size limit is measured in bytes and multi-byte characters
would otherwise be undercounted.

Tags in the same call are written into the same batch — no separate per-article
commit is needed for tags.

Both `backupArticle` (single-article canonical path) and `backupArticlesPaginated`
(chunk batch) delegate to `addArticleToBatch`.

### Chunk size

```kotlin
private const val WRITE_BATCH_LIMIT = 20
```

At most 20 articles go into one batched write, which keeps each commit small. The cap
was first set by the rules' per-write `getAfter()` budget for app-written markers; the
app no longer writes markers, so that budget no longer applies, and the cap stays for
commit size. `WRITE_COUNT_THRESHOLD = 500` also closes a batch before its queued write
count would pass 500; an article is never split across two batches.

---

## Push runs

`FirestoreSyncManager.pushLocalChanges()` returns a `SyncRunResult` (pushed, failed,
the transient error that stopped the run, or no user), and the workers map it to
WorkManager results.

- **What a run sends.** After the first sync, a run selects every row whose current
  version this device has not backed up (`backed_up_at IS NULL OR backed_up_at <
  timeUpdated`), changed up to the run's start, in keyset pages of
  (`timeUpdated`, `itemId`) (`ArticleSql.CHANGED_SINCE_KEYSET`). Last sync is
  account-wide (another device moves it), so it does not decide which rows are unsent.
  A first sync sends every row. Deleted rows are sent as `deletedAt`.
- **The stamp.** Each pushed article is stamped with the `timeUpdated` it was sent
  with, and only while its row still has that version
  (`ArticleDao.recordPushResults`, the only place a push stamps `backed_up_at`). An edit
  made while the push is in flight leaves the row unsynced for the next run.
- **Failures.** A transient failure (offline, timeout, no user) stops the run with
  nothing recorded. Any other chunk failure retries the chunk one article at a time;
  an article that fails on its own gets a strike (`sync_failures`), and after
  `MAX_SYNC_FAILURES` (3) the push skips it. Settings shows a row with the skipped
  count and a Retry action (`SyncFailures.retry`).
- **Last sync** moves only when a run finishes with nothing failed.
- **What each push sends with an article.** `pushChunk` loads the article's tags and its
  image, author and video rows, so the push loop, the per-article retry, the
  never-backed-up sweep and the inline backup after a save
  (`FirestoreSyncManager.backupArticleNow`) all send them.

## Owner guard and wipe

- `LocalDataOwner` stores the uid that owns the local library. Every push, restore and
  inline backup runs only when the signed-in uid owns it (or no owner is stored).
- One gate (`syncGate`) serialises push runs, full syncs, the inline backup and the
  wipe. `LocalDataReset.wipeLocalData()` runs inside `runExclusive`: a restore in
  progress stops at its next page, a push stops between chunks, and no run writes the
  cleared library back.
- "Clear data" and a sign-in by a different uid go through `PushThenWipe`: pending
  changes are pushed first (at most 15 seconds), and when some stay unsent the person
  decides. The wipe deletes every table, the archive folder and the image cache, and
  asks for the Firestore on-device cache to be cleared at the next app start
  (`FirestoreCacheReset`; Firestore clears it only before its client starts).

---

## Sync deduplication — `applyRemoteArticles`

```kotlin
private suspend fun applyRemoteArticles(articles: List<Article>)
```

`FirestoreSyncManager` uses this private function at every restore call site
(`performFullSync` and `performBidirectionalSync`). It:

1. Batch-fetches tags for all articles in the page via
   `firestoreBackupService.batchRestoreArticleTags(articles.map { it.itemId })`.
2. Iterates the articles and calls `handleRemoteArticleChange(article, prefetchedTags)`
   for each one, with its pre-fetched tags supplied.

`handleRemoteArticleChange` does not issue any Firestore reads for tags. All tag
reads are concentrated in the single `batchRestoreArticleTags` call above.

---

## Streamed restore — memory contract

```kotlin
suspend fun restoreAllArticlesPaginated(
    onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
    onPage: suspend (List<Article>) -> Unit = {}
): Result<Unit>
```

Pages of `RESTORE_PAGE_LIMIT = 50` articles are delivered to `onPage` as they
arrive. No page is accumulated — the previous API that returned
`Result<List<Article>>` has been removed.

**Backpressure:** `onPage` is `suspend` and is awaited before the next Firestore
page query is issued. Room writes inside `onPage` complete before more articles
are fetched, keeping heap usage bounded to one page at a time regardless of
library size.

**Partial-restore on failure:** if `onPage` throws or a Firestore read fails, the
function stops paging and returns `Result.failure`. Room already contains articles
from delivered pages; a subsequent sync will fill gaps via idempotent upsert.

---

## Large-text rehydration on restore (A2b)

```kotlin
private suspend fun rehydrateLargeText(article: Article, articleRef: DocumentReference): Article
```

Articles whose `text` field was `null` in the Firestore document (meaning their
text was stored in the `text/content` subcollection at backup time) are rehydrated
by `rehydrateLargeText` inside the paging loop, **before** `onPage` is called.

Articles with non-null inline text return immediately with no extra Firestore read.
This brings bulk restore (`restoreAllArticlesPaginated`) to parity with
single-article restore (`restoreArticle`), which already performed this
rehydration.

---

## Batched tag reads

See [`batched-tag-reads.md`](./batched-tag-reads.md) for the full reference.

`batchRestoreArticleTags` on `FirestoreBackupService` reads tags for a list of
article IDs concurrently, using `coroutineScope { ... async { ... }.awaitAll() }`
with a chunk iteration size of `RESTORE_TAG_CHUNK_SIZE = 10`. All async jobs are
started within a single `coroutineScope` and awaited together — the chunk size
controls iteration batch size, not sequential rounds. A `collectionGroup` query
was evaluated and rejected (no `userId` field in tag documents, cross-user
isolation impossible without a schema migration).

---

## Search

Search runs on the FTS5 index `article_fts` over `title` and `text` (tokenizer
`porter unicode61 remove_diacritics 2`), kept in step with `article` by Room's content
triggers.

- `FtsMatchQuery.build(input)` turns each typed word, and each quoted phrase, into a
  quoted FTS5 string and joins them with `OR`, so any word matches and operator words
  and symbols (`NEAR`, `AND`, `-`, `*`, `"`) match as literal words.
- `ArticleSql.SEARCH_RANKED` orders by `bm25(article_fts)` (best first), leaves out
  deleted articles and returns at most `SEARCH_RESULT_LIMIT = 100` rows; the snippet
  marks matched words in bold.
- `FtsIndexCheckCallback` compares the index row count with `article` at every open and
  rebuilds the index when they differ.
- `ArticleSearchViewModel.search` cancels the previous search, so only the newest
  result reaches the screen.
