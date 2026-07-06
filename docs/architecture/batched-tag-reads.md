# Batched tag reads — reference

Concise reference for the query shape used to read tags in bulk during restore,
and the rationale for the client-side approach. Audience: a developer debugging a
restore or adding a new subcollection read pattern.

---

## Function signature

```kotlin
// FirestoreBackupService.kt
suspend fun batchRestoreArticleTags(
    articleIds: List<String>
): Map<String, List<ArticleTags>>
```

Returns a map from `articleId` to its list of `ArticleTags`. Articles with no
tags are present in the map with an empty list. Returns an empty map when
`articleIds` is empty or the user is not authenticated.

---

## Query shape

For each article ID, reads the full tag subcollection:

```
users/{uid}/articles/{articleId}/tags/   (full subcollection get)
```

IDs are iterated in chunks of `RESTORE_TAG_CHUNK_SIZE = 10`. All async reads
are dispatched inside a single `coroutineScope` and awaited together:

```kotlin
return coroutineScope {
    articleIds
        .chunked(RESTORE_TAG_CHUNK_SIZE)
        .flatMap { chunk ->
            chunk.map { articleId ->
                async {
                    val snap = getUserArticlesCollection(user.uid)
                        .document(articleId)
                        .collection(TAGS_COLLECTION)
                        .get()
                        .await()
                    articleId to (snap.documents.mapNotNull { it.toObject(ArticleTags::class.java) })
                }
            }
        }
        .awaitAll()
        .toMap()
}
```

All async jobs are started concurrently within the `coroutineScope` — the chunk
size controls iteration batch size for code clarity, not sequential rounds. The
`awaitAll()` waits for all reads before returning.

---

## Why not `collectionGroup`

Three reasons a `collectionGroup("tags")` query was not used:

1. **No `userId` field on tag documents.** `ArticleTags` documents carry `itemId`,
   `tag`, `sortId`, and `type` — no `userId`. A `collectionGroup` query cannot
   filter to the authenticated user's tags without this field, making cross-user
   data isolation impossible at the query level.

2. **No `firestore.indexes.json` in the project.** Adding a `COLLECTION_GROUP`-scoped
   composite index would require creating that file and deploying Firestore
   configuration changes. This is a shared-infrastructure change out of scope for
   a client-side efficiency improvement.

3. **Schema migration out of scope.** Adding `userId` to every existing tag document
   would require a one-time migration of all users' data.

The client-side concurrent-read approach avoids all three constraints.

---

## Chunk size

```kotlin
private const val RESTORE_TAG_CHUNK_SIZE = 10  // in FirestoreBackupService.companion
```

10 is well below any documented Firestore SDK concurrent-read limit. To change
the concurrency level, update this constant only. Keep it at or below 30 (the
Firestore `whereIn` operator cap) for future refactoring symmetry if a
`whereIn`-based approach becomes viable.

---

## Single-article path

`restoreArticleTags(articleId)` is the existing single-article tag read, used by
`restoreArticle()`. It is **not** replaced by `batchRestoreArticleTags` — the
single-article path remains correct and is unchanged. `batchRestoreArticleTags`
is called from `applyRemoteArticles` in `FirestoreSyncManager` to prefetch tags
for a whole page of articles before Room writes begin.
