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
| `ARTICLE_MARKERS_COLLECTION = "articleMarkers"` | `articleMarkers/{key}` | Existence markers (gating the article read rule) |
| `TAGS_COLLECTION = "tags"` | `articles/{itemId}/tags/{itemId}_{tag}` | Tag subcollection |
| `IMAGES_COLLECTION = "images"` | `articles/{itemId}/images/{imageId}` | Image subcollection |
| `VIDEOS_COLLECTION = "videos"` | `articles/{itemId}/videos/{videoId}` | Video subcollection |
| `AUTHORS_COLLECTION = "authors"` | `articles/{itemId}/authors/{authorId}` | Author subcollection |
| `DOMAIN_METADATA_COLLECTION = "domain_metadata"` | `articles/{itemId}/domain_metadata/metadata` | Domain metadata |
| `ARTICLE_TEXT_COLLECTION = "text"` | `articles/{itemId}/text/content` | Large-text overflow store |

The string literals for all collection names live exclusively in
`FirestoreBackupService.companion`. No other class constructs these path strings —
they are composed via private helpers (`getUserArticlesCollection`, etc.).

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

### Chunk size and the Firestore rules budget

```kotlin
private const val WRITE_BATCH_LIMIT = 20
```

The tightened Firestore security rules call `getAfter()` on the article document
for each articleMarker write in a batch. Firestore allows at most 20
document-access calls per batched write. Each article contributes one unique path,
so chunk sizes must not exceed 20. The `WRITE_BATCH_LIMIT` constant enforces this.

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

## FTS search fix

`ArticleRepositoryImpl.searchWithScore(query)` computes:

```kotlin
val sanitizedQuery = sanitizeSearchQuery("*$query*")
return articleDao.searchArticlesWithMatchInfo(sanitizedQuery)
```

Previously the raw `query` (not `sanitizedQuery`) was passed to the DAO — the
sanitized value was computed but silently discarded. The fix passes `sanitizedQuery`
to the DAO.

**Result-set impact:** queries containing FTS-special characters (`*`, unbalanced
quotes, `AND`/`OR`/`NEAR` operators) now return results matching sanitized +
wildcard semantics. Queries that previously caused a malformed `MATCH` expression
(which would throw or return empty) now return correct results.
