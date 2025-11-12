package com.jayteealao.trails.services.firestore

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.network.DomainMetadata
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

            // Save article
            batch.set(articleRef, article, SetOptions.merge())

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

            // Process in chunks of 500 (Firestore batch limit)
            articles.chunked(500).forEach { chunk ->
                val batch = firestore.batch()

                chunk.forEach { article ->
                    val articleRef = getUserArticlesCollection(user.uid)
                        .document(article.itemId)
                    batch.set(articleRef, article, SetOptions.merge())
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

            val articleDoc = getUserArticlesCollection(user.uid)
                .document(articleId)
                .get()
                .await()

            if (articleDoc.exists()) {
                val article = articleDoc.toObject(Article::class.java)
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
     * Restore all articles for the current user
     */
    suspend fun restoreAllArticles(): Result<List<Article>> {
        return try {
            val user = getCurrentUser()
                ?: return Result.failure(Exception("User not authenticated"))

            val snapshot = getUserArticlesCollection(user.uid)
                .get()
                .await()

            val articles = snapshot.documents.mapNotNull { doc ->
                doc.toObject(Article::class.java)
            }

            Timber.d("Successfully restored ${articles.size} articles for user ${user.uid}")
            Result.success(articles)
        } catch (e: Exception) {
            Timber.e(e, "Failed to restore articles")
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
}
