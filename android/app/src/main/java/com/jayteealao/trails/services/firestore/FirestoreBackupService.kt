package com.jayteealao.trails.services.firestore

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.WriteBatch
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.network.DomainMetadata
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.tasks.await
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Service for backing up and restoring articles to/from Firestore
 * Each user's articles are stored under: users/{userId}/articles/{articleId}
 */
@Singleton
class FirestoreBackupService @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth
) {
    companion object {
        private const val USERS_COLLECTION = "users"
        private const val ARTICLES_COLLECTION = "articles"
        private const val TAGS_COLLECTION = "tags"
        private const val IMAGES_COLLECTION = "images"
        private const val VIDEOS_COLLECTION = "videos"
        private const val AUTHORS_COLLECTION = "authors"
        private const val DOMAIN_METADATA_COLLECTION = "domain_metadata"
        private const val ARTICLE_TEXT_COLLECTION = "text"
        // MAX_TEXT_SIZE is compared against toByteArray().size (byte count), not text.length (char count).
        // Firestore's 1 MiB doc limit is bytes; leaving 100KB buffer above 900KB for other fields.
        private const val MAX_TEXT_SIZE = 900_000
        // At most 20 articles per batched write keeps each commit small. The app no
        // longer writes the server-owned link docs, so the old per-article rules
        // getAfter budget that first set this cap no longer applies.
        private const val WRITE_BATCH_LIMIT = 20
        // Throughput-hygiene target for backupArticlesPaginated: close a batch before
        // the next article would push the queued write count past this threshold.
        // Firestore's hard limit is 10 MiB per commit (not a write count), so 500 is a
        // conservative ceiling that keeps individual commits small and predictable when
        // articles carry many tags. An article is never split across two batches.
        private const val WRITE_COUNT_THRESHOLD = 500
        // Read-side page size for restore operations — independent of the write-batch budget.
        private const val RESTORE_PAGE_LIMIT = 50
        // Number of article IDs dispatched concurrently per round in batchRestoreArticleTags.
        // 10 parallel subcollection reads per round gives ceil(N/10) wall-clock round-trips
        // instead of N sequential reads; well below any documented Firestore SDK limit.
        private const val RESTORE_TAG_CHUNK_SIZE = 10
    }

    /**
     * Get the current authenticated user
     */
    private fun getCurrentUser(): FirebaseUser? = auth.currentUser

    /**
     * Write the article doc (and its large-text subcollection when needed) onto
     * [batch]. Large text (> [MAX_TEXT_SIZE] bytes) is stored in the
     * `text/content` subcollection and the article doc is saved with `text = null`.
     * Small text stays inline. This is the single source for the large-text branch;
     * [backupArticle] and [backupArticlesPaginated] both delegate to it.
     *
     * When [tags] is non-empty, each tag doc is also written into the same [batch]
     * so tag writes commit atomically with the article — no separate batch commit
     * per article (efficiency-2). The default [emptyList] preserves the existing
     * call sites in [backupArticle] that handle tags separately.
     *
     * Each image, author and video row in [rows] is written as one doc in the article's
     * `images` / `authors` / `videos` subcollection, in the same [batch]. An article
     * without rows writes no row doc.
     */
    private fun addArticleToBatch(
        batch: WriteBatch,
        articleRef: DocumentReference,
        article: Article,
        tags: List<ArticleTags> = emptyList(),
        rows: ArticleRows = ArticleRows()
    ) {
        val textSize = article.text?.toByteArray()?.size ?: 0
        val articleToSave = if (textSize > MAX_TEXT_SIZE && article.text != null) {
            val textRef = articleRef.collection(ARTICLE_TEXT_COLLECTION).document("content")
            batch.set(textRef, mapOf("text" to article.text), SetOptions.merge())
            article.copy(text = null)
        } else {
            article
        }
        batch.set(articleRef, articleToSave.toBackupFields(), SetOptions.merge())
        // Write tags into the same batch (efficiency-2: no separate per-article commit).
        tags.forEach { tag ->
            val tagRef = articleRef.collection(TAGS_COLLECTION)
                .document("${tag.itemId}_${tag.tag}")
            batch.set(tagRef, tag, SetOptions.merge())
        }
        rows.images.forEach { image ->
            val imageRef = articleRef.collection(IMAGES_COLLECTION).document(rowDocId(image.imageId))
            batch.set(imageRef, image.toFirestoreFields(), SetOptions.merge())
        }
        rows.authors.forEach { author ->
            val authorRef = articleRef.collection(AUTHORS_COLLECTION).document(rowDocId(author.authorId))
            batch.set(authorRef, author.toFirestoreFields(), SetOptions.merge())
        }
        rows.videos.forEach { video ->
            val videoRef = articleRef.collection(VIDEOS_COLLECTION).document(rowDocId(video.videoId))
            batch.set(videoRef, video.toFirestoreFields(), SetOptions.merge())
        }
    }

    /**
     * Get the user's articles collection reference
     */
    private fun getUserArticlesCollection(userId: String) =
        firestore.collection(USERS_COLLECTION)
            .document(userId)
            .collection(ARTICLES_COLLECTION)

    /**
     * Auth guard for methods returning [Result]. Calls [block] with the current
     * [FirebaseUser] when signed in; returns [Result.failure] immediately when not.
     *
     * Do NOT use this in [FirestoreSyncManager] — its auth guards return early
     * with `_syncStatus.value = SyncStatus.Error(...)`, which is intentionally
     * distinct from this [Result.failure] pattern.
     */
    private suspend fun <T> withAuthenticatedUser(
        block: suspend (user: FirebaseUser) -> Result<T>
    ): Result<T> {
        val user = getCurrentUser()
            ?: return Result.failure(Exception("User not authenticated"))
        return block(user)
    }

    /**
     * Backup a single article with all its related data
     */
    suspend fun backupArticle(
        article: Article,
        tags: List<ArticleTags> = emptyList(),
        images: List<ArticleImages> = emptyList(),
        videos: List<ArticleVideos> = emptyList(),
        authors: List<ArticleAuthors> = emptyList(),
        domainMetadata: DomainMetadata? = null
    ): Result<Unit> {
        return withAuthenticatedUser { user ->
            try {
                val articleRef = getUserArticlesCollection(user.uid)
                    .document(article.itemId)

                // Use batch write for atomic operation
                val batch = firestore.batch()

                // Write article doc (and large-text subcollection when needed), plus its
                // image, author and video rows through the row codec.
                addArticleToBatch(batch, articleRef, article, rows = ArticleRows(images, authors, videos))

                // Save tags
                tags.forEach { tag ->
                    val tagRef = articleRef.collection(TAGS_COLLECTION)
                        .document("${tag.itemId}_${tag.tag}")
                    batch.set(tagRef, tag, SetOptions.merge())
                }

                // Save domain metadata if present
                domainMetadata?.let { metadata ->
                    val metadataRef = articleRef.collection(DOMAIN_METADATA_COLLECTION)
                        .document("metadata")
                    batch.set(metadataRef, metadata, SetOptions.merge())
                }

                // Commit batch
                batch.commit().await()

                Timber.d("Successfully backed up article ${article.itemId} for user ${user.uid}")
                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "Failed to backup article ${article.itemId}")
                Result.failure(e)
            }
        }
    }

    /**
     * Backup multiple articles in batch
     */
    suspend fun backupArticles(articles: List<Article>): Result<Int> {
        return withAuthenticatedUser { user ->
            try {
                var successCount = 0

                // Process in chunks of WRITE_BATCH_LIMIT (20 articles) to keep each
                // commit small; the cap is no longer a rules-budget requirement.
                articles.chunked(WRITE_BATCH_LIMIT).forEach { chunk ->
                    val batch = firestore.batch()

                    chunk.forEach { article ->
                        val articleRef = getUserArticlesCollection(user.uid)
                            .document(article.itemId)
                        batch.set(articleRef, article.toBackupFields(), SetOptions.merge())
                    }

                    batch.commit().await()
                    successCount += chunk.size
                }

                Timber.d("Successfully backed up $successCount articles for user ${user.uid}")
                Result.success(successCount)
            } catch (e: Exception) {
                Timber.e(e, "Failed to backup articles")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore a single article from Firestore
     */
    suspend fun restoreArticle(articleId: String): Result<Article?> {
        return withAuthenticatedUser { user ->
            try {
                val articleRef = getUserArticlesCollection(user.uid)
                    .document(articleId)

                val articleDoc = articleRef.get().await()

                if (articleDoc.exists()) {
                    // Same deletion read as the bulk restore; no heal write here.
                    val rawArticle = articleDoc.toRestored()?.first
                    val article = rawArticle?.let { rehydrateLargeText(it, articleRef) }
                    if (article?.text != rawArticle?.text) {
                        Timber.d("Restored separate text for article $articleId")
                    }
                    Timber.d("Successfully restored article $articleId")
                    Result.success(article)
                } else {
                    Result.success(null)
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Map a restored article doc through [RemoteDeletion]: the article with its deletion
     * read from `deletedAt` or the legacy `deleted_at`, and the heal write fields (null
     * when the doc needs none).
     */
    private fun DocumentSnapshot.toRestored(): Pair<Article, Map<String, Any>?>? {
        val article = toObject(Article::class.java) ?: return null
        val resolution = RemoteDeletion.resolve(
            deletedAt = getLong(RemoteDeletion.FIELD),
            legacyDeletedAt = getLong(RemoteDeletion.LEGACY_FIELD),
            legacyPresent = contains(RemoteDeletion.LEGACY_FIELD),
            timeUpdated = article.timeUpdated,
        )
        return article.withRemoteDeletion(resolution, id) to RemoteDeletion.healFields(resolution.heal)
    }

    /**
     * Rewrite legacy `deleted_at` docs to `deletedAt` in one batch. Best effort: a
     * failure is logged and the next restore heals again.
     */
    private suspend fun commitDeletionHeals(heals: List<Pair<DocumentReference, Map<String, Any>>>) {
        if (heals.isEmpty()) return
        try {
            val batch = firestore.batch()
            heals.forEach { (ref, fields) -> batch.set(ref, fields, SetOptions.merge()) }
            batch.commit().await()
            Timber.d("Healed ${heals.size} legacy deletion keys")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "Failed to heal ${heals.size} legacy deletion keys; the next restore retries")
        }
    }

    /**
     * Fetch large article text from the `text/content` subcollection when the article
     * doc was stored without inline text (text == null, meaning the text exceeded
     * [MAX_TEXT_SIZE] at backup time). Articles with non-null text are returned
     * unchanged without an extra Firestore read.
     *
     * Brings the bulk restore path to parity with [restoreArticle], which already
     * performs this rehydration for single-article fetches.
     */
    private suspend fun rehydrateLargeText(article: Article, articleRef: DocumentReference): Article {
        if (article.text != null) return article
        return try {
            val textDoc = articleRef.collection(ARTICLE_TEXT_COLLECTION)
                .document("content")
                .get()
                .await()
            if (textDoc.exists()) {
                val text = textDoc.getString("text")
                article.copy(text = text)
            } else {
                article
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to rehydrate large text for article ${article.itemId}")
            article
        }
    }

    /**
     * Restore all articles with pagination and a per-page callback.
     *
     * Each page of [RESTORE_PAGE_LIMIT] articles is delivered to [onPage] as it
     * arrives; no page is retained after [onPage] returns. Memory is bounded by
     * one page at a time regardless of library size.
     *
     * Articles whose text was stored in the `text/content` subcollection (text == null
     * in the main doc) are rehydrated before [onPage] is called, bringing bulk restore
     * to parity with [restoreArticle].
     *
     * **Partial-restore on failure:** if [onPage] throws or a Firestore read fails,
     * the function stops paging and returns [Result.failure]. Room may already contain
     * articles from delivered pages; a subsequent sync will fill gaps via idempotent
     * upsert.
     *
     * @param onProgress Called after each page with (current, total) counts.
     * @param onPage Called with each page of rehydrated articles. Must be fast enough
     *   not to starve the paging loop; it blocks the loop while running (natural
     *   backpressure — Firestore reads only advance after Room writes complete).
     * @return [Result.success] on completion; [Result.failure] on any error.
     */
    suspend fun restoreAllArticlesPaginated(
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
        onPage: suspend (List<Article>) -> Unit = {}
    ): Result<Unit> {
        return withAuthenticatedUser { user ->
            try {
                var lastDocument: com.google.firebase.firestore.DocumentSnapshot? = null
                var hasMore = true
                var fetchedCount = 0

                // Fetch total count for progress reporting.
                val countSnapshot = getUserArticlesCollection(user.uid)
                    .count()
                    .get(com.google.firebase.firestore.AggregateSource.SERVER)
                    .await()
                val totalCount = countSnapshot.count.toInt()

                Timber.d("Starting paginated restore of $totalCount articles")

                while (hasMore) {
                    val query = if (lastDocument != null) {
                        getUserArticlesCollection(user.uid)
                            .orderBy("timeAdded")
                            .startAfter(lastDocument)
                            .limit(RESTORE_PAGE_LIMIT.toLong())
                    } else {
                        getUserArticlesCollection(user.uid)
                            .orderBy("timeAdded")
                            .limit(RESTORE_PAGE_LIMIT.toLong())
                    }

                    val snapshot = query.get().await()

                    if (snapshot.documents.isEmpty()) {
                        hasMore = false
                    } else {
                        // Read the deletion from either key (RemoteDeletion) and queue the
                        // heal write for docs that still carry the legacy key.
                        val heals = mutableListOf<Pair<DocumentReference, Map<String, Any>>>()
                        val articles = snapshot.documents.mapNotNull { doc ->
                            doc.toRestored()?.let { (article, healFields) ->
                                if (healFields != null) heals += doc.reference to healFields
                                article
                            }
                        }

                        // Heal before onPage: a local-wins push during onPage must not be
                        // overwritten by a later heal write.
                        commitDeletionHeals(heals)

                        // Rehydrate large text from subcollection (parity with restoreArticle).
                        val hydratedArticles = articles.map { article ->
                            val articleRef = getUserArticlesCollection(user.uid).document(article.itemId)
                            rehydrateLargeText(article, articleRef)
                        }

                        fetchedCount += hydratedArticles.size
                        lastDocument = snapshot.documents.lastOrNull()

                        onProgress(fetchedCount, totalCount)
                        Timber.d("onPage called with ${hydratedArticles.size} articles (total so far: $fetchedCount / $totalCount)")
                        onPage(hydratedArticles)

                        if (articles.size < RESTORE_PAGE_LIMIT) {
                            hasMore = false
                        }
                    }
                }

                Timber.d("Paginated restore complete: $fetchedCount articles for user ${user.uid}")
                Result.success(Unit)
            } catch (e: CancellationException) {
                // Re-throw to preserve cooperative structured cancellation.
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore articles with pagination")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore tags for a specific article
     */
    suspend fun restoreArticleTags(articleId: String): Result<List<ArticleTags>> {
        return withAuthenticatedUser { user ->
            try {
                val snapshot = getUserArticlesCollection(user.uid)
                    .document(articleId)
                    .collection(TAGS_COLLECTION)
                    .get()
                    .await()

                val tags = snapshot.documents.mapNotNull { doc ->
                    tagFromFirestore(doc.data ?: emptyMap(), articleId)
                }

                Result.success(tags)
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore tags for article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore tags for multiple articles in parallel batches.
     *
     * Instead of N sequential subcollection reads (one per article), this method
     * dispatches up to [RESTORE_TAG_CHUNK_SIZE] reads concurrently per round, reducing
     * wall-clock time to ceil(N / RESTORE_TAG_CHUNK_SIZE) round-trips.
     *
     * Articles with no tags are returned as entries mapping to an empty list — no
     * exception is thrown for missing subcollections.
     *
     * @param articleIds IDs of the articles whose tags should be fetched.
     * @return Map from articleId to its list of [ArticleTags] (empty list when none).
     *   Returns an empty map when [articleIds] is empty or the user is unauthenticated.
     */
    suspend fun batchRestoreArticleTags(
        articleIds: List<String>
    ): Map<String, List<ArticleTags>> {
        if (articleIds.isEmpty()) return emptyMap()
        val user = getCurrentUser() ?: return emptyMap()
        return coroutineScope {
            articleIds
                .chunked(RESTORE_TAG_CHUNK_SIZE)
                .flatMap { chunk ->
                    chunk.map { articleId ->
                        async {
                            val snap = try {
                                getUserArticlesCollection(user.uid)
                                    .document(articleId)
                                    .collection(TAGS_COLLECTION)
                                    .get()
                                    .await()
                            } catch (e: Exception) {
                                Timber.w(e, "batchRestoreArticleTags: failed to fetch tags for $articleId")
                                null
                            }
                            articleId to (
                                snap?.documents?.mapNotNull { tagFromFirestore(it.data ?: emptyMap(), articleId) }
                                    ?: emptyList()
                                )
                        }
                    }
                }
                .awaitAll()
                .toMap()
        }
    }

    /**
     * Restore images for a specific article. Rows are read through the row codec:
     * the object mapper cannot build [ArticleImages] (no no-argument constructor).
     * A doc without a usable `src` is skipped.
     */
    suspend fun restoreArticleImages(articleId: String): Result<List<ArticleImages>> {
        return withAuthenticatedUser { user ->
            try {
                val snapshot = getUserArticlesCollection(user.uid)
                    .document(articleId)
                    .collection(IMAGES_COLLECTION)
                    .get()
                    .await()

                val images = snapshot.documents.mapNotNull { doc ->
                    imageFromFirestore(doc.id, doc.data ?: emptyMap(), articleId)
                }

                Result.success(images)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore images for article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore authors for a specific article, through the row codec as
     * [restoreArticleImages] does. A doc without a usable `name` is skipped.
     */
    suspend fun restoreArticleAuthors(articleId: String): Result<List<ArticleAuthors>> {
        return withAuthenticatedUser { user ->
            try {
                val snapshot = getUserArticlesCollection(user.uid)
                    .document(articleId)
                    .collection(AUTHORS_COLLECTION)
                    .get()
                    .await()

                val authors = snapshot.documents.mapNotNull { doc ->
                    authorFromFirestore(doc.id, doc.data ?: emptyMap(), articleId)
                }

                Result.success(authors)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore authors for article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore video rows for a specific article, through the row codec as
     * [restoreArticleImages] does. A doc without a usable `src` is skipped.
     */
    suspend fun restoreArticleVideos(articleId: String): Result<List<ArticleVideos>> {
        return withAuthenticatedUser { user ->
            try {
                val snapshot = getUserArticlesCollection(user.uid)
                    .document(articleId)
                    .collection(VIDEOS_COLLECTION)
                    .get()
                    .await()

                val videos = snapshot.documents.mapNotNull { doc ->
                    videoFromFirestore(doc.id, doc.data ?: emptyMap(), articleId)
                }

                Result.success(videos)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to restore videos for article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Restore the image, author and video rows of several articles, all in parallel as
     * [batchRestoreArticleTags] does, with each article's three reads made at the same
     * time.
     *
     * An article whose images, authors or videos read failed is left out of the map, so the
     * caller changes nothing for it; an article without rows maps to an empty
     * [ArticleRows]. Returns an empty map when [articleIds] is empty or no user is
     * signed in.
     */
    suspend fun batchRestoreArticleRows(articleIds: List<String>): Map<String, ArticleRows> {
        if (articleIds.isEmpty()) return emptyMap()
        if (getCurrentUser() == null) return emptyMap()
        val reads = coroutineScope {
            articleIds.map { articleId ->
                async {
                    val images = async { restoreArticleImages(articleId) }
                    val authors = async { restoreArticleAuthors(articleId) }
                    val videos = async { restoreArticleVideos(articleId) }
                    RowReads(articleId, images.await(), authors.await(), videos.await())
                }
            }.awaitAll()
        }
        val restored = mutableMapOf<String, ArticleRows>()
        for (read in reads) {
            val images = read.images.getOrNull()
            val authors = read.authors.getOrNull()
            val videos = read.videos.getOrNull()
            if (images == null || authors == null || videos == null) {
                Timber.w(
                    read.images.exceptionOrNull() ?: read.authors.exceptionOrNull() ?: read.videos.exceptionOrNull(),
                    "batchRestoreArticleRows: failed to fetch rows for ${read.articleId}"
                )
            } else {
                restored[read.articleId] = ArticleRows(images, authors, videos)
            }
        }
        return restored
    }

    /**
     * Delete an article from Firestore
     */
    suspend fun deleteArticle(articleId: String): Result<Unit> {
        return withAuthenticatedUser { user ->
            try {
                getUserArticlesCollection(user.uid)
                    .document(articleId)
                    .delete()
                    .await()

                Timber.d("Successfully deleted article $articleId from Firestore")
                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "Failed to delete article $articleId")
                Result.failure(e)
            }
        }
    }

    /**
     * Get the last sync timestamp for the user
     */
    suspend fun getLastSyncTimestamp(): Result<Long?> {
        return withAuthenticatedUser { user ->
            try {
                val doc = firestore.collection(USERS_COLLECTION)
                    .document(user.uid)
                    .get()
                    .await()

                val timestamp = doc.getLong("lastSyncTimestamp")
                Result.success(timestamp)
            } catch (e: Exception) {
                Timber.e(e, "Failed to get last sync timestamp")
                Result.failure(e)
            }
        }
    }

    /**
     * Update the last sync timestamp
     */
    suspend fun updateLastSyncTimestamp(timestamp: Long = System.currentTimeMillis()): Result<Unit> {
        return withAuthenticatedUser { user ->
            try {
                firestore.collection(USERS_COLLECTION)
                    .document(user.uid)
                    .set(mapOf("lastSyncTimestamp" to timestamp), SetOptions.merge())
                    .await()

                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "Failed to update last sync timestamp")
                Result.failure(e)
            }
        }
    }

    /**
     * Check if this is the first sync for the user
     * Returns true if no lastSyncTimestamp exists
     */
    suspend fun isFirstSync(): Result<Boolean> {
        return withAuthenticatedUser { user ->
            try {
                val doc = firestore.collection(USERS_COLLECTION)
                    .document(user.uid)
                    .get()
                    .await()

                val hasTimestamp = doc.exists() && doc.contains("lastSyncTimestamp")
                Result.success(!hasTimestamp)
            } catch (e: Exception) {
                Timber.e(e, "Failed to check first sync status")
                Result.failure(e)
            }
        }
    }

    /**
     * Snapshot of user-level sync metadata: a single read of users/{uid} that
     * covers both the first-sync flag and the last-sync timestamp. Use this
     * instead of separate [isFirstSync] + [getLastSyncTimestamp] calls to halve
     * the number of Firestore GETs on every [FirestoreSyncManager.syncLocalChanges]
     * invocation (efficiency-1).
     */
    data class UserMetaSnapshot(val isFirstSync: Boolean, val lastSyncTimestamp: Long?)

    /**
     * Read users/{uid} once and return both the [isFirstSync] flag and the
     * [lastSyncTimestamp] — a single Firestore GET instead of two.
     *
     * [isFirstSync] is `true` when the document has no `lastSyncTimestamp` field.
     * [lastSyncTimestamp] is `null` when the field is absent.
     */
    suspend fun getUserMetaSnapshot(): Result<UserMetaSnapshot> = withAuthenticatedUser { user ->
        try {
            val doc = firestore.collection(USERS_COLLECTION)
                .document(user.uid)
                .get()
                .await()
            val hasTimestamp = doc.exists() && doc.contains("lastSyncTimestamp")
            val timestamp = doc.getLong("lastSyncTimestamp")
            Result.success(UserMetaSnapshot(isFirstSync = !hasTimestamp, lastSyncTimestamp = timestamp))
        } catch (e: Exception) {
            Timber.e(e, "Failed to get user meta snapshot")
            Result.failure(e)
        }
    }

    /**
     * Check if remote articles exist in Firestore
     * Returns the count of remote articles
     */
    suspend fun getRemoteArticleCount(): Result<Int> {
        return withAuthenticatedUser { user ->
            try {
                val countSnapshot = getUserArticlesCollection(user.uid)
                    .count()
                    .get(com.google.firebase.firestore.AggregateSource.SERVER)
                    .await()

                val count = countSnapshot.count.toInt()
                Timber.d("Remote article count: $count")
                Result.success(count)
            } catch (e: Exception) {
                Timber.e(e, "Failed to get remote article count")
                Result.failure(e)
            }
        }
    }

    /**
     * Backup articles with pagination and progress callback.
     *
     * Tags for each article can be supplied via [tagsByArticleId]. When present,
     * each article's tags are written into the same [WriteBatch] as the article doc
     * — no separate per-article commit is needed (efficiency-2). Callers
     * that do not need tag backup (e.g. the reconcile sweep) use the default
     * [emptyMap].
     *
     * Each batch holds at most [WRITE_BATCH_LIMIT] (20) articles and at most
     * [WRITE_COUNT_THRESHOLD] queued writes. The 20-article cap keeps commits small;
     * the old per-article rules budget that first set it no longer applies.
     *
     * Image and author rows from [rowsByArticleId] are written in the article's batch
     * and count toward the write threshold; an article is still never split across
     * batches, so one result covers the article and its rows.
     *
     * @param articles List of articles to backup
     * @param tagsByArticleId Pre-fetched tags keyed by [Article.itemId]; default [emptyMap]
     * @param onProgress Callback with (current, total) counts
     * @param rowsByArticleId Image and author rows keyed by [Article.itemId]; default [emptyMap]
     */
    suspend fun backupArticlesPaginated(
        articles: List<Article>,
        tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap(),
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
        rowsByArticleId: Map<String, ArticleRows> = emptyMap()
    ): Result<Int> {
        return withAuthenticatedUser { user ->
            try {
                var successCount = 0
                val totalCount = articles.size

                Timber.d("Starting paginated backup of $totalCount articles")

                // Process in write-count-aware chunks bounded by both write count and
                // article count. Each article contributes a variable number of writes:
                // 1 article doc + optionally 1 large-text subcollection doc +
                // tags.size tag docs + one doc per image and author row.  We flush before adding an article that would
                // either push the write total past WRITE_COUNT_THRESHOLD or push the
                // article count to WRITE_BATCH_LIMIT (20, kept to keep commits small).
                // A single article is never split across two batches (all-or-nothing
                // within a chunk is preserved).
                var batch = firestore.batch()
                var batchWriteCount = 0
                var batchArticleCount = 0
                var chunkIndex = 0

                articles.forEach { article ->
                    val tags = tagsByArticleId[article.itemId] ?: emptyList()
                    val rows = rowsByArticleId[article.itemId] ?: ArticleRows()
                    val textSize = article.text?.toByteArray()?.size ?: 0
                    val largeTextWrites = if (textSize > MAX_TEXT_SIZE && article.text != null) 1 else 0
                    val articleWrites = 1 + largeTextWrites + tags.size + rows.writeCount

                    // Flush the current batch if this article would exceed either limit.
                    // Always flush after the first article even if it alone exceeds a limit
                    // (we never split a single article across batches).
                    if (batchWriteCount > 0 && (batchWriteCount + articleWrites > WRITE_COUNT_THRESHOLD || batchArticleCount >= WRITE_BATCH_LIMIT)) {
                        batch.commit().await()
                        onProgress(successCount, totalCount)
                        Timber.d("Backed up $successCount / $totalCount articles (chunk ${chunkIndex + 1})")
                        batch = firestore.batch()
                        batchWriteCount = 0
                        batchArticleCount = 0
                        chunkIndex++
                    }

                    val articleRef = getUserArticlesCollection(user.uid).document(article.itemId)
                    addArticleToBatch(batch, articleRef, article, tags, rows)
                    batchWriteCount += articleWrites
                    batchArticleCount++
                    successCount++
                }

                // Commit the final (possibly only) batch.
                if (batchWriteCount > 0) {
                    batch.commit().await()
                    onProgress(successCount, totalCount)
                    Timber.d("Backed up $successCount / $totalCount articles (chunk ${chunkIndex + 1})")
                }

                Timber.d("Successfully backed up $successCount articles for user ${user.uid}")
                Result.success(successCount)
            } catch (e: Exception) {
                Timber.e(e, "Failed to backup articles with pagination")
                Result.failure(e)
            }
        }
    }
}

/**
 * The field map the backup writes for an article: one entry per [Article]
 * property, keyed by the property name, except `resolvedId`. The server owns
 * `resolvedId` on the user's article doc, so a merge write that omits it leaves
 * the server value untouched. Restore still reads it back through `toObject`.
 * A field added to [Article] must be added here too; a unit test checks parity.
 * `backedUpAt` is the version this write sends: the stamp the device records when the
 * commit succeeds. Older builds read it back on restore.
 */
internal fun Article.toBackupFields(): Map<String, Any?> = mapOf(
    "itemId" to itemId,
    "title" to title,
    "givenTitle" to givenTitle,
    "url" to url,
    "givenUrl" to givenUrl,
    "normalizedUrl" to normalizedUrl,
    "excerpt" to excerpt,
    "wordCount" to wordCount,
    "favorite" to favorite,
    "status" to status,
    "wordCountMessage" to wordCountMessage,
    "image" to image,
    "hasImage" to hasImage,
    "hasVideo" to hasVideo,
    "hasAudio" to hasAudio,
    "sortId" to sortId,
    "timeAdded" to timeAdded,
    "timeUpdated" to timeUpdated,
    "timeRead" to timeRead,
    "timeFavorited" to timeFavorited,
    "timeToRead" to timeToRead,
    "listenDurationEstimate" to listenDurationEstimate,
    "text" to text,
    "articleId" to articleId,
    "resolved" to resolved,
    "deletedAt" to deletedAt,
    "archivedAt" to archivedAt,
    "textSource" to textSource,
    "backedUpAt" to timeUpdated,
)

/** The three row reads of one article in [FirestoreBackupService.batchRestoreArticleRows]. */
private class RowReads(
    val articleId: String,
    val images: Result<List<ArticleImages>>,
    val authors: Result<List<ArticleAuthors>>,
    val videos: Result<List<ArticleVideos>>,
)
