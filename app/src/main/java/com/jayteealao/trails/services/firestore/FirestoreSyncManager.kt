package com.jayteealao.trails.services.firestore

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sync status for UI display
 */
sealed class SyncStatus {
    object Idle : SyncStatus()
    object Syncing : SyncStatus()
    data class Success(val message: String) : SyncStatus()
    data class Error(val message: String, val exception: Exception?) : SyncStatus()
}

/**
 * Manages bidirectional sync between local Room database and Firestore
 * Uses periodic background sync (every 15 min) with pagination to avoid OOM
 *
 * IMPORTANT: Realtime sync is DISABLED for large datasets
 * - Firestore snapshot listeners load entire collections into memory
 * - For thousands of articles with large text fields, this causes OutOfMemoryError
 * - No pagination support for snapshot listeners in Firestore SDK
 * - Instead, we use WorkManager periodic sync with chunked processing
 */
@Singleton
class FirestoreSyncManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth,
    private val articleDao: ArticleDao,
    private val firestoreBackupService: FirestoreBackupService
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _lastSyncTime = MutableStateFlow(0L)
    val lastSyncTime: StateFlow<Long> = _lastSyncTime.asStateFlow()

    private val _syncStatus = MutableStateFlow<SyncStatus>(SyncStatus.Idle)
    val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    companion object {
        private const val USERS_COLLECTION = "users"
        private const val ARTICLES_COLLECTION = "articles"
        private const val SYNC_WORK_NAME = "FirestoreBidirectionalSync"
    }

    /**
     * Handle remote article change with conflict resolution
     * Uses timestamp-based last-write-wins strategy
     * Also restores related data (tags, images, etc.)
     */
    private suspend fun handleRemoteArticleChange(remoteArticle: Article) {
        try {
            val localArticle = articleDao.getArticleById(remoteArticle.itemId)

            if (localArticle == null) {
                // New article - insert with related data
                articleDao.upsertArticle(remoteArticle)

                // Restore tags
                val remoteTags = firestoreBackupService.restoreArticleTags(remoteArticle.itemId)
                remoteTags.getOrNull()?.let { tags ->
                    if (tags.isNotEmpty()) {
                        articleDao.insertArticleTags(tags)
                        Timber.d("Restored ${tags.size} tags for article ${remoteArticle.itemId}")
                    }
                }

                Timber.d("Inserted new article ${remoteArticle.itemId} from remote")
            } else {
                // Conflict resolution: compare timestamps
                if (shouldAcceptRemoteChange(localArticle, remoteArticle)) {
                    articleDao.upsertArticle(remoteArticle)

                    // Restore tags (replace existing)
                    val remoteTags = firestoreBackupService.restoreArticleTags(remoteArticle.itemId)
                    remoteTags.getOrNull()?.let { tags ->
                        // Delete existing tags first
                        val existingTags = articleDao.getArticleTags(remoteArticle.itemId)
                        existingTags.forEach { tag ->
                            articleDao.deleteArticleTag(remoteArticle.itemId, tag)
                        }
                        // Insert remote tags
                        if (tags.isNotEmpty()) {
                            articleDao.insertArticleTags(tags)
                        }
                        Timber.d("Updated ${tags.size} tags for article ${remoteArticle.itemId}")
                    }

                    Timber.d("Updated article ${remoteArticle.itemId} from remote (remote newer)")
                } else {
                    Timber.d("Kept local version of ${remoteArticle.itemId} (local newer)")
                    // Local is newer, push to Firestore
                    pushLocalArticle(localArticle)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle remote article ${remoteArticle.itemId}")
        }
    }

    /**
     * Conflict resolution strategy
     * Returns true if remote change should be accepted
     */
    private fun shouldAcceptRemoteChange(local: Article, remote: Article): Boolean {
        // Compare timeUpdated timestamps
        // If timestamps are equal, compare other fields for tie-breaking
        return when {
            remote.timeUpdated > local.timeUpdated -> true
            remote.timeUpdated < local.timeUpdated -> false
            else -> {
                // Timestamps equal - use other criteria
                // Prefer the one with more data (non-null text, favorite, etc.)
                val remoteScore = calculateArticleCompleteness(remote)
                val localScore = calculateArticleCompleteness(local)
                remoteScore >= localScore
            }
        }
    }

    /**
     * Calculate completeness score for tie-breaking
     */
    private fun calculateArticleCompleteness(article: Article): Int {
        var score = 0
        if (!article.text.isNullOrBlank()) score += 10
        if (article.favorite == "1" || article.timeFavorited > 0) score += 5
        if (article.timeRead != null && article.timeRead!! > 0) score += 5
        if (!article.excerpt.isNullOrBlank()) score += 3
        if (article.wordCount > 0) score += 2
        return score
    }

    /**
     * Push local article with related data to Firestore
     */
    private suspend fun pushLocalArticle(article: Article) {
        val user = auth.currentUser ?: return

        try {
            // Fetch related data
            val tags = articleDao.getArticleTags(article.itemId).map { tag ->
                ArticleTags(
                    itemId = article.itemId,
                    tag = tag,
                    sortId = null,
                    type = null
                )
            }

            // Backup article with related data
            firestoreBackupService.backupArticle(
                article = article,
                tags = tags,
                images = emptyList(), // TODO: fetch images when needed
                videos = emptyList(), // TODO: fetch videos when needed
                authors = emptyList(), // TODO: fetch authors when needed
                domainMetadata = null // TODO: fetch metadata when needed
            )

            Timber.d("Pushed local article ${article.itemId} with ${tags.size} tags to Firestore")
        } catch (e: Exception) {
            Timber.e(e, "Failed to push article ${article.itemId}")
        }
    }

    /**
     * Sync local changes to Firestore
     * Pushes articles modified since last sync, or all articles on first sync
     * Uses chunked processing to avoid OutOfMemoryError with large datasets
     */
    suspend fun syncLocalChanges() {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot sync - user not authenticated")
            _syncStatus.value = SyncStatus.Error("Not authenticated", null)
            return
        }

        try {
            _isSyncing.value = true
            _syncStatus.value = SyncStatus.Syncing
            _lastError.value = null

            // Check if this is first sync
            val isFirstSync = firestoreBackupService.isFirstSync().getOrNull() ?: false
            val lastSync = firestoreBackupService.getLastSyncTimestamp().getOrNull() ?: 0L

            // Get count of articles to sync (without loading them all into memory)
            val totalCount = when {
                isFirstSync -> {
                    Timber.d("First sync detected - counting all existing articles")
                    articleDao.countAllArticles()
                }
                lastSync > 0 -> {
                    articleDao.countArticlesModifiedSince(lastSync)
                }
                else -> {
                    articleDao.countAllArticles()
                }
            }

            if (totalCount == 0) {
                Timber.d("No local changes to sync")
                _syncStatus.value = SyncStatus.Success("Up to date")

                // Still update timestamp even if nothing to sync
                if (isFirstSync) {
                    firestoreBackupService.updateLastSyncTimestamp()
                }
                return
            }

            Timber.d("Syncing $totalCount articles with related data (firstSync=$isFirstSync)")

            var successCount = 0
            var failureCount = 0
            // Adaptive chunk size: larger for first sync to reduce API calls
            val chunkSize = if (isFirstSync && totalCount > 1000) {
                200 // Larger chunks for big initial syncs
            } else {
                50  // Smaller chunks for regular syncs
            }

            // Process articles in chunks to avoid OOM
            var offset = 0
            while (offset < totalCount) {
                try {
                    // Fetch chunk of articles
                    val chunk = when {
                        isFirstSync -> articleDao.getAllArticlesPaginated(chunkSize, offset)
                        lastSync > 0 -> articleDao.getArticlesModifiedSincePaginated(lastSync, chunkSize, offset)
                        else -> articleDao.getAllArticlesPaginated(chunkSize, offset)
                    }

                    if (chunk.isEmpty()) break

                    // Backup this chunk
                    val backupResult = firestoreBackupService.backupArticlesPaginated(
                        articles = chunk,
                        onProgress = { current, _ ->
                            val totalProgress = offset + current
                            _syncStatus.value = SyncStatus.Syncing
                            Timber.d("Syncing $totalProgress / $totalCount articles")
                        }
                    )

                    backupResult.fold(
                        onSuccess = { count ->
                            successCount += count

                            // Backup tags for this chunk
                            chunk.forEach { article ->
                                try {
                                    val tags = articleDao.getArticleTags(article.itemId).map { tag ->
                                        com.jayteealao.trails.network.ArticleTags(
                                            itemId = article.itemId,
                                            tag = tag,
                                            sortId = null,
                                            type = null
                                        )
                                    }

                                    if (tags.isNotEmpty()) {
                                        val currentUser = auth.currentUser ?: return@forEach
                                        val articleRef = firestore.collection("users")
                                            .document(currentUser.uid)
                                            .collection("articles")
                                            .document(article.itemId)

                                        val batch = firestore.batch()
                                        tags.forEach { tag ->
                                            val tagRef = articleRef.collection("tags")
                                                .document("${tag.itemId}_${tag.tag}")
                                            batch.set(tagRef, tag, com.google.firebase.firestore.SetOptions.merge())
                                        }
                                        batch.commit().await()
                                    }
                                } catch (e: Exception) {
                                    Timber.w(e, "Failed to backup tags for article ${article.itemId}")
                                }
                            }
                        },
                        onFailure = { error ->
                            Timber.e(error, "Failed to backup chunk at offset $offset")
                            failureCount += chunk.size
                        }
                    )

                    offset += chunk.size
                } catch (e: Exception) {
                    Timber.e(e, "Error processing chunk at offset $offset")
                    failureCount += chunkSize
                    offset += chunkSize
                }
            }

            // Update last sync timestamp
            firestoreBackupService.updateLastSyncTimestamp()
            val now = System.currentTimeMillis()
            _lastSyncTime.value = now

            val message = if (failureCount > 0) {
                "Synced $successCount articles, $failureCount failed"
            } else {
                if (isFirstSync) {
                    "Initial backup complete: $successCount articles"
                } else {
                    "Synced $successCount articles"
                }
            }

            _syncStatus.value = SyncStatus.Success(message)
            Timber.d("Successfully synced local changes: $message")
        } catch (e: Exception) {
            Timber.e(e, "Failed to sync local changes")
            _lastError.value = e.message ?: "Sync failed"
            _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
        } finally {
            _isSyncing.value = false
        }
    }

    /**
     * Schedule periodic background sync
     * Should be called after WorkManager is fully initialized
     */
    fun schedulePeriodicSync() {
        val syncRequest = PeriodicWorkRequestBuilder<FirestoreSyncWorker>(
            15, TimeUnit.MINUTES // Sync every 15 minutes
        ).build()

        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(
                SYNC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                syncRequest
            )
    }

    /**
     * Cancel periodic sync
     */
    fun cancelPeriodicSync() {
        WorkManager.getInstance(context).cancelUniqueWork(SYNC_WORK_NAME)
    }

    /**
     * Perform full bidirectional sync with pagination
     * Intelligently handles first sync scenarios:
     * - New device with remote data → restore only
     * - Existing user upgrading → backup only
     * - Both have data → bidirectional sync
     */
    suspend fun performFullSync() {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot perform full sync - user not authenticated")
            _syncStatus.value = SyncStatus.Error("Not authenticated", null)
            return
        }

        try {
            _isSyncing.value = true
            _syncStatus.value = SyncStatus.Syncing
            _lastError.value = null

            // Check if this is first sync
            val isFirstSync = firestoreBackupService.isFirstSync().getOrNull() ?: false

            if (isFirstSync) {
                Timber.d("First sync detected - determining sync strategy")

                // Get counts to determine strategy (without loading all articles)
                val localCount = articleDao.countAllArticles()
                val remoteCount = firestoreBackupService.getRemoteArticleCount().getOrNull() ?: 0

                Timber.d("First sync counts - Local: $localCount, Remote: $remoteCount")

                when {
                    localCount > 0 && remoteCount == 0 -> {
                        // Scenario 1: Existing user upgrading - backup local data
                        Timber.d("First sync: Backup scenario (existing user upgrading)")
                        _syncStatus.value = SyncStatus.Syncing
                        syncLocalChanges() // This will backup all local articles
                    }
                    localCount == 0 && remoteCount > 0 -> {
                        // Scenario 2: New device - restore from remote
                        Timber.d("First sync: Restore scenario (new device with remote data)")
                        _syncStatus.value = SyncStatus.Syncing

                        val remoteResult = firestoreBackupService.restoreAllArticlesPaginated(
                            onProgress = { current, total ->
                                _syncStatus.value = SyncStatus.Syncing
                                Timber.d("Restoring $current / $total articles")
                            }
                        )

                        remoteResult.fold(
                            onSuccess = { remoteArticles ->
                                Timber.d("Applying ${remoteArticles.size} remote articles")
                                // Run on IO dispatcher to ensure database operations don't block main thread
                                withContext(Dispatchers.IO) {
                                    remoteArticles.chunked(50).forEachIndexed { chunkIndex, chunk ->
                                        chunk.forEach { remoteArticle ->
                                            handleRemoteArticleChange(remoteArticle)
                                        }
                                        Timber.d("Processed chunk ${chunkIndex + 1}")
                                    }
                                }
                                _syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")
                            },
                            onFailure = { error ->
                                Timber.e(error, "Failed to restore remote articles")
                                throw error
                            }
                        )

                        // Mark as synced
                        firestoreBackupService.updateLastSyncTimestamp()
                        _lastSyncTime.value = System.currentTimeMillis()
                    }
                    localCount > 0 && remoteCount > 0 -> {
                        // Scenario 3: Both have data - full bidirectional sync
                        Timber.d("First sync: Bidirectional scenario (both have data)")
                        performBidirectionalSync()
                    }
                    else -> {
                        // Scenario 4: Neither has data - just mark as synced
                        Timber.d("First sync: No data on either side")
                        firestoreBackupService.updateLastSyncTimestamp()
                        _lastSyncTime.value = System.currentTimeMillis()
                        _syncStatus.value = SyncStatus.Success("Up to date")
                    }
                }
            } else {
                // Regular sync - always bidirectional
                Timber.d("Regular sync - performing bidirectional sync")
                performBidirectionalSync()
            }

            Timber.d("Full sync completed successfully")
        } catch (e: Exception) {
            Timber.e(e, "Full sync failed: ${e.message}")
            _lastError.value = e.message ?: "Full sync failed"
            _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
        } finally {
            _isSyncing.value = false
        }
    }

    /**
     * Perform bidirectional sync (pull remote, push local)
     */
    private suspend fun performBidirectionalSync() {
        // First, pull remote changes with pagination
        val remoteResult = firestoreBackupService.restoreAllArticlesPaginated(
            onProgress = { current, total ->
                _syncStatus.value = SyncStatus.Syncing
                Timber.d("Restoring $current / $total articles")
            }
        )

        remoteResult.fold(
            onSuccess = { remoteArticles ->
                if (remoteArticles.isNotEmpty()) {
                    Timber.d("Applying ${remoteArticles.size} remote articles")
                    _syncStatus.value = SyncStatus.Syncing

                    // Process articles in chunks to avoid memory issues
                    // Run on IO dispatcher to ensure database operations don't block main thread
                    withContext(Dispatchers.IO) {
                        remoteArticles.chunked(50).forEachIndexed { chunkIndex, chunk ->
                            chunk.forEach { remoteArticle ->
                                handleRemoteArticleChange(remoteArticle)
                            }
                            Timber.d("Processed chunk ${chunkIndex + 1} of ${(remoteArticles.size + 49) / 50}")
                        }
                    }
                } else {
                    Timber.d("No remote articles to restore")
                }
            },
            onFailure = { error ->
                Timber.e(error, "Failed to restore remote articles")
                throw error
            }
        )

        // Then push local changes with pagination
        syncLocalChanges()
    }

    /**
     * Clean up resources
     */
    fun cleanup() {
        cancelPeriodicSync()
        scope.cancel()
    }
}
