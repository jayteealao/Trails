package com.jayteealao.trails.services.firestore

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
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
        private const val ARTICLE_MARKERS_COLLECTION = "articleMarkers"
        private const val TAGS_COLLECTION = "tags"
        private const val IMAGES_COLLECTION = "images"
        private const val VIDEOS_COLLECTION = "videos"
        private const val AUTHORS_COLLECTION = "authors"
        private const val DOMAIN_METADATA_COLLECTION = "domain_metadata"
        private const val ARTICLE_TEXT_COLLECTION = "text"
        private const val MAX_TEXT_SIZE = 900_000 // 900KB to leave buffer for other fields
        // Rules budget: each article in a batch costs one getAfter call on
        // users/{uid}/articles/{itemId}. Firestore allows at most 20 document-
        // access calls per batched write (same-path calls are cached, but each
        // article has a unique path). Keep chunk sizes ≤ 20.
        private const val WRITE_BATCH_LIMIT = 20 // ≤ 20 so each batch's marker getAfter() calls fit the Firestore rules document-access budget
        // Read-side page size for restore operations — independent of the write-batch budget.
        private const val RESTORE_PAGE_LIMIT = 50
    }

    /**
     * Get the current authenticated user
     */
    private fun getCurrentUser(): FirebaseUser? = auth.currentUser

    /**
     * Get the user's articles collection reference
     */
    private fun getUserArticlesCollection(userId: String) =
        firestore.collection(USERS_COLLECTION)
            .document(userId)
            .collection(ARTICLES_COLLECTION)

    /**
     * Get the user's article-marker collection reference.
     * One existence marker is written per saved article key under
     * users/{userId}/articleMarkers/{key}; this gates the (later) tightened
     * top-level `articles` read.
     */
    private fun getUserMarkersCollection(userId: String) =
        firestore.collection(USERS_COLLECTION)
            .document(userId)
            .collection(ARTICLE_MARKERS_COLLECTION)

    /**
     * Marker doc keys for an article: its [Article.itemId] always, plus
     * [Article.resolvedId] when present and distinct (the network mapper
     * sometimes leaves it blank). Deduped so the read rule's single exists()
     * check matches whichever key a reader passes.
     */
    private fun markerKeysFor(article: Article): List<String> {
        val keys = mutableListOf(article.itemId)
        val resolved = article.resolvedId
        if (!resolved.isNullOrBlank() && resolved != article.itemId) {
            keys.add(resolved)
        }
        return keys
    }

    /**
     * Minimal marker body. `itemId` is the doc id of the user's own article at
     * users/{userId}/articles/{itemId} — required by the tightened create/update
     * rule to prove the caller owns the referenced article. Both the itemId-keyed
     * and the resolvedId-keyed marker for the same article carry the same
     * [articleItemId] so the rules path cache only needs one getAfter call per
     * article.
     */
    private fun markerBody(key: String, source: String, articleItemId: String): Map<String, Any> =
        mapOf(
            "key" to key,
            "itemId" to articleItemId,
            "createdAt" to FieldValue.serverTimestamp(),
            "source" to source,
        )

    /**
     * Queue marker writes for [article] onto an existing [batch] so they
     * commit atomically with the article doc. Keyed by [markerKeysFor].
     * Both the itemId-keyed and resolvedId-keyed markers carry itemId =
     * article.itemId so the rules' getAfter check resolves to the same
     * article doc path (cached — only one access call per article).
     */
    private fun addMarkerWrites(batch: WriteBatch, userId: String, article: Article) {
        val markers = getUserMarkersCollection(userId)
        markerKeysFor(article).forEach { key ->
            batch.set(markers.document(key), markerBody(key, "sync", article.itemId), SetOptions.merge())
        }
    }

    /**
     * Write a single article-existence marker for the current user. Reused by
     * the archive read-path self-heal when a read is denied for an owned
     * article key. Idempotent (merge); records source = "self-heal".
     *
     * [key] is the marker doc id (itemId or resolvedId). [itemId] is the doc
     * id of the user's own article at users/{uid}/articles/{itemId}; it must
     * match an existing article doc so the tightened create/update rule's
     * getAfter check passes. When the self-heal is triggered for an itemId-keyed
     * read (the common case) [key] and [itemId] are the same value; pass them
     * separately when healing a resolvedId-keyed marker.
     */
    suspend fun writeArticleMarker(key: String, itemId: String = key): Result<Unit> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            getUserMarkersCollection(user.uid)
                .document(key)
                .set(markerBody(key, "self-heal", itemId), SetOptions.merge())
                .await()

            Timber.d("Wrote self-heal marker for key $key (itemId=$itemId)")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to write self-heal marker for key $key")
            Result.failure(e)
        }
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
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            val articleRef = getUserArticlesCollection(user.uid)
                .document(article.itemId)

            // Use batch write for atomic operation
            val batch = firestore.batch()

            // Handle large article text (>900KB)
            val articleToSave: Article
            val textSize = article.text?.toByteArray()?.size ?: 0

            if (textSize > MAX_TEXT_SIZE && article.text != null) {
                Timber.d("Article ${article.itemId} text is large ($textSize bytes), storing separately")

                // Save text in separate subcollection
                val textRef = articleRef.collection(ARTICLE_TEXT_COLLECTION)
                    .document("content")
                batch.set(textRef, mapOf("text" to article.text), SetOptions.merge())

                // Save article without text
                articleToSave = article.copy(text = null)
            } else {
                articleToSave = article
            }

            // Save article (with or without text)
            batch.set(articleRef, articleToSave, SetOptions.merge())

            // Save tags
            tags.forEach { tag ->
                val tagRef = articleRef.collection(TAGS_COLLECTION)
                    .document("${tag.itemId}_${tag.tag}")
                batch.set(tagRef, tag, SetOptions.merge())
            }

            // Save images
            images.forEach { image ->
                val imageRef = articleRef.collection(IMAGES_COLLECTION)
                    .document(image.imageId)
                batch.set(imageRef, image, SetOptions.merge())
            }

            // Save videos
            videos.forEach { video ->
                val videoRef = articleRef.collection(VIDEOS_COLLECTION)
                    .document(video.videoId)
                batch.set(videoRef, video, SetOptions.merge())
            }

            // Save authors
            authors.forEach { author ->
                val authorRef = articleRef.collection(AUTHORS_COLLECTION)
                    .document(author.authorId)
                batch.set(authorRef, author, SetOptions.merge())
            }

            // Save domain metadata if present
            domainMetadata?.let { metadata ->
                val metadataRef = articleRef.collection(DOMAIN_METADATA_COLLECTION)
                    .document("metadata")
                batch.set(metadataRef, metadata, SetOptions.merge())
            }

            // Write existence marker(s) atomically with the article doc
            addMarkerWrites(batch, user.uid, article)

            // Commit batch
            batch.commit().await()

            Timber.d("Successfully backed up article ${article.itemId} for user ${user.uid}")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to backup article ${article.itemId}")
            Result.failure(e)
        }
    }

    /**
     * Backup multiple articles in batch
     */
    suspend fun backupArticles(articles: List<Article>): Result<Int> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            var successCount = 0

            // Process in chunks of WRITE_BATCH_LIMIT: the tightened marker create/update rule
            // calls getAfter on users/{uid}/articles/{itemId} per article.
            // Firestore batched writes allow at most 20 document-access calls;
            // each article contributes one unique path, so chunks must be ≤ 20.
            articles.chunked(WRITE_BATCH_LIMIT).forEach { chunk ->
                val batch = firestore.batch()

                chunk.forEach { article ->
                    val articleRef = getUserArticlesCollection(user.uid)
                        .document(article.itemId)
                    batch.set(articleRef, article, SetOptions.merge())

                    // Write existence marker(s) atomically with the article doc so
                    // the tightened `articles` read rule can verify ownership.
                    addMarkerWrites(batch, user.uid, article)
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

    /**
     * Restore a single article from Firestore
     */
    suspend fun restoreArticle(articleId: String): Result<Article?> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            val articleRef = getUserArticlesCollection(user.uid)
                .document(articleId)

            val articleDoc = articleRef.get().await()

            if (articleDoc.exists()) {
                val rawArticle = articleDoc.toObject(Article::class.java)
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
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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
                    val articles = snapshot.documents.mapNotNull { doc ->
                        doc.toObject(Article::class.java)
                    }

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

    /**
     * Restore tags for a specific article
     */
    suspend fun restoreArticleTags(articleId: String): Result<List<ArticleTags>> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            val snapshot = getUserArticlesCollection(user.uid)
                .document(articleId)
                .collection(TAGS_COLLECTION)
                .get()
                .await()

            val tags = snapshot.documents.mapNotNull { doc ->
                doc.toObject(ArticleTags::class.java)
            }

            Result.success(tags)
        } catch (e: Exception) {
            Timber.e(e, "Failed to restore tags for article $articleId")
            Result.failure(e)
        }
    }

    /**
     * Restore images for a specific article
     */
    suspend fun restoreArticleImages(articleId: String): Result<List<ArticleImages>> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            val snapshot = getUserArticlesCollection(user.uid)
                .document(articleId)
                .collection(IMAGES_COLLECTION)
                .get()
                .await()

            val images = snapshot.documents.mapNotNull { doc ->
                doc.toObject(ArticleImages::class.java)
            }

            Result.success(images)
        } catch (e: Exception) {
            Timber.e(e, "Failed to restore images for article $articleId")
            Result.failure(e)
        }
    }

    /**
     * Delete an article from Firestore
     */
    suspend fun deleteArticle(articleId: String): Result<Unit> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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

    /**
     * Get the last sync timestamp for the user
     */
    suspend fun getLastSyncTimestamp(): Result<Long?> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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

    /**
     * Update the last sync timestamp
     */
    suspend fun updateLastSyncTimestamp(timestamp: Long = System.currentTimeMillis()): Result<Unit> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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

    /**
     * Check if this is the first sync for the user
     * Returns true if no lastSyncTimestamp exists
     */
    suspend fun isFirstSync(): Result<Boolean> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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

    /**
     * Check if remote articles exist in Firestore
     * Returns the count of remote articles
     */
    suspend fun getRemoteArticleCount(): Result<Int> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

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

    /**
     * Backup articles with pagination and progress callback
     * @param articles List of articles to backup
     * @param onProgress Callback with (current, total) counts
     */
    suspend fun backupArticlesPaginated(
        articles: List<Article>,
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> }
    ): Result<Int> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            var successCount = 0
            val totalCount = articles.size

            Timber.d("Starting paginated backup of $totalCount articles")

            // Process in chunks of WRITE_BATCH_LIMIT to respect the Firestore rules document-access budget
            articles.chunked(WRITE_BATCH_LIMIT).forEachIndexed { chunkIndex, chunk ->
                val batch = firestore.batch()

                chunk.forEach { article ->
                    val articleRef = getUserArticlesCollection(user.uid)
                        .document(article.itemId)

                    // Handle large text
                    val textSize = article.text?.toByteArray()?.size ?: 0
                    val articleToSave = if (textSize > MAX_TEXT_SIZE && article.text != null) {
                        val textRef = articleRef.collection(ARTICLE_TEXT_COLLECTION)
                            .document("content")
                        batch.set(textRef, mapOf("text" to article.text), SetOptions.merge())
                        article.copy(text = null)
                    } else {
                        article
                    }

                    batch.set(articleRef, articleToSave, SetOptions.merge())

                    // Write existence marker(s) alongside each article in the chunk.
                    // Chunk size ≤ 20 (WRITE_BATCH_LIMIT) keeps the rules budget:
                    // one getAfter per article = at most 20 document-access calls.
                    addMarkerWrites(batch, user.uid, article)
                }

                batch.commit().await()
                successCount += chunk.size

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
