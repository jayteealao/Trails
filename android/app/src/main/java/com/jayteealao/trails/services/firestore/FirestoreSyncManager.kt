package com.jayteealao.trails.services.firestore

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.common.di.ApplicationScope
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
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
    private val firestoreBackupService: FirestoreBackupService,
    @ApplicationScope private val scope: CoroutineScope
) {

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _lastSyncTime = MutableStateFlow(0L)
    val lastSyncTime: StateFlow<Long> = _lastSyncTime.asStateFlow()

    private val _syncStatus = MutableStateFlow<SyncStatus>(SyncStatus.Idle)
    val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    companion object {
        private const val SYNC_WORK_NAME = "FirestoreBidirectionalSync"
        // Keep ≤ 20 to stay within the Firestore rules document-access budget per
        // batched write (one getAfter call per article, max 20 per batch).
        private const val RECONCILE_CHUNK_SIZE = 20
    }

    /**
     * Handle remote article change with conflict resolution.
     * Uses timestamp-based last-write-wins strategy.
     *
     * Tags are supplied by the caller as [prefetchedTags]; no Firestore read is
     * issued here for tags. Use [applyRemoteArticles] to batch-prefetch tags before
     * calling this function.
     *
     * @param remoteArticle The article received from Firestore.
     * @param prefetchedTags Tags for this article, pre-fetched by [applyRemoteArticles].
     */
    private suspend fun handleRemoteArticleChange(
        remoteArticle: Article,
        prefetchedTags: List<ArticleTags>
    ) {
        try {
            val localArticle = articleDao.getArticleById(remoteArticle.itemId)

            if (localArticle == null) {
                // New article - insert with related data
                articleDao.upsertArticle(remoteArticle.copy(
                    normalizedUrl = remoteArticle.computeNormalizedUrl()
                ))

                // Apply pre-fetched tags
                if (prefetchedTags.isNotEmpty()) {
                    articleDao.insertArticleTags(prefetchedTags)
                    Timber.d("Restored ${prefetchedTags.size} tags for article ${remoteArticle.itemId}")
                }

                Timber.d("Inserted new article ${remoteArticle.itemId} from remote")
            } else {
                // Conflict resolution: compare timestamps
                if (shouldAcceptRemoteChange(localArticle, remoteArticle)) {
                    articleDao.upsertArticle(remoteArticle.copy(
                        normalizedUrl = remoteArticle.computeNormalizedUrl()
                    ))

                    // Replace tags: bulk delete (efficiency-3: N DAO calls → 1 DAO call)
                    // then insert remote tags. See ArticleDao.deleteAllTagsForArticle KDoc
                    // for the brief delete-insert window caveat.
                    articleDao.deleteAllTagsForArticle(remoteArticle.itemId)
                    if (prefetchedTags.isNotEmpty()) {
                        articleDao.insertArticleTags(prefetchedTags)
                    }
                    Timber.d("Updated ${prefetchedTags.size} tags for article ${remoteArticle.itemId}")

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
     * Batch-fetch tags for all articles in [articles] then apply each article
     * to Room via [handleRemoteArticleChange].
     *
     * Tags for the whole list are fetched in one [FirestoreBackupService.batchRestoreArticleTags]
     * call (ceil(N/RESTORE_TAG_CHUNK_SIZE) parallel round-trips) rather than one
     * sequential subcollection read per article. Room writes follow tag retrieval.
     *
     * @param articles The page of remote articles to apply.
     */
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

            // Single user-meta read covers both isFirstSync and lastSyncTimestamp (efficiency-1).
            val meta = firestoreBackupService.getUserMetaSnapshot().getOrNull()
            val isFirstSync = meta?.isFirstSync ?: false
            val lastSync = meta?.lastSyncTimestamp ?: 0L

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

                    // Pre-fetch tags for this chunk in one bulk IN-query so they fold into
                    // the chunk batch (efficiency-2: no separate per-article commit; tags
                    // written in same batch). Uses getTagsForArticles to avoid N serial DAO
                    // reads (review fix CR-1).
                    val allChunkTags = articleDao.getTagsForArticles(chunk.map { it.itemId })
                    val chunkTagsMap = allChunkTags.groupBy { it.itemId }

                    // Backup this chunk with pre-fetched tags folded into each batch commit.
                    val backupResult = firestoreBackupService.backupArticlesPaginated(
                        articles = chunk,
                        tagsByArticleId = chunkTagsMap,
                        onProgress = { current, _ ->
                            val totalProgress = offset + current
                            _syncStatus.value = SyncStatus.Syncing
                            Timber.d("Syncing $totalProgress / $totalCount articles")
                        }
                    )

                    backupResult.fold(
                        onSuccess = { count ->
                            successCount += count
                            // B2: tags now folded into the chunk batch; no separate per-article commit.
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

            // Class-B reconciliation sweep: back up any article that was saved locally
            // but never reached Firestore (backed_up_at IS NULL). These are articles
            // that were saved offline, had an inline backup failure, or pre-date the
            // backed_up_at column. Chunk size ≤ 20 respects the Firestore rules budget.
            reconcileNeverBackedUpArticles()

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

            // Check if this is first sync — use getUserMetaSnapshot() (single Firestore read)
            // instead of isFirstSync() to match the efficiency-1 fix in syncLocalChanges
            // (review fix CR-2).
            val syncMeta = firestoreBackupService.getUserMetaSnapshot().getOrNull()
            val isFirstSync = syncMeta?.isFirstSync ?: false

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

                        firestoreBackupService.restoreAllArticlesPaginated(
                            onProgress = { current, total ->
                                _syncStatus.value = SyncStatus.Syncing
                                Timber.d("Restoring $current / $total articles")
                            },
                            onPage = { pageArticles ->
                                applyRemoteArticles(pageArticles)
                            }
                        ).onFailure { error ->
                            Timber.e(error, "Failed to restore remote articles")
                            throw error
                        }

                        _syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")

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
            // Re-throw CancellationException so structured concurrency propagates correctly
            // (review fix RE-1).
            if (e is CancellationException) throw e
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
        // First, pull remote changes with pagination — each page written to Room on arrival.
        firestoreBackupService.restoreAllArticlesPaginated(
            onProgress = { current, total ->
                _syncStatus.value = SyncStatus.Syncing
                Timber.d("Restoring $current / $total articles")
            },
            onPage = { pageArticles ->
                applyRemoteArticles(pageArticles)
            }
        ).onFailure { error ->
            Timber.e(error, "Failed to restore remote articles")
            throw error
        }

        // Then push local changes with pagination
        syncLocalChanges()
    }

    /**
     * Back up articles that were saved locally but never successfully backed up to
     * Firestore ([Article.backedUpAt] IS NULL). This handles:
     * - Articles saved while offline (inline backup failed silently).
     * - Articles saved before the [Article.backedUpAt] column was added (NULL by default).
     * - The live Class-B case (e.g. `XrU724etfGYUZ9`) that stranded ~18h without archives.
     *
     * Processes in pages of [RECONCILE_CHUNK_SIZE] to respect the Firestore rules
     * document-access budget (≤ 20 getAfter calls per batched write).
     */
    // internal for testability
    internal suspend fun reconcileNeverBackedUpArticles() {
        if (auth.currentUser == null) return
        var offset = 0
        var sweptCount = 0
        while (true) {
            val chunk = articleDao.getArticlesNeverBackedUp(RECONCILE_CHUNK_SIZE, offset)
            if (chunk.isEmpty()) break
            val result = firestoreBackupService.backupArticlesPaginated(chunk)
            result.fold(
                onSuccess = { count ->
                    val now = System.currentTimeMillis()
                    chunk.forEach { article ->
                        try {
                            articleDao.updateBackedUpAt(article.itemId, now)
                        } catch (e: Exception) {
                            Timber.w(e, "reconcile: failed to stamp backed_up_at for ${article.itemId}")
                        }
                    }
                    sweptCount += count
                    Timber.d("reconcile: swept $count articles at offset $offset (total so far: $sweptCount)")
                },
                onFailure = { e ->
                    Timber.w(e, "reconcile: backup failed for chunk at offset $offset, stopping sweep")
                    return
                }
            )
            offset += chunk.size
        }
        if (sweptCount > 0) {
            Timber.d("reconcile: finished, swept $sweptCount never-backed-up articles")
        }
    }

    /**
     * Clean up resources
     */
    fun cleanup() {
        cancelPeriodicSync()
        // scope is an @ApplicationScope @Singleton — do NOT cancel it here; it is app-lifetime managed
    }
}
