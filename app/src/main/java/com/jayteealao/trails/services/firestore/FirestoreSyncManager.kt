package com.jayteealao.trails.services.firestore

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages bidirectional sync between local Room database and Firestore
 * Provides real-time sync with conflict resolution for multi-device support
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
    private var syncListener: ListenerRegistration? = null

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _lastSyncTime = MutableStateFlow(0L)
    val lastSyncTime: StateFlow<Long> = _lastSyncTime.asStateFlow()

    companion object {
        private const val USERS_COLLECTION = "users"
        private const val ARTICLES_COLLECTION = "articles"
        private const val SYNC_WORK_NAME = "FirestoreBidirectionalSync"
    }

    /**
     * Start real-time sync listener
     * Listens for remote changes and applies them locally with conflict resolution
     */
    fun startRealtimeSync() {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot start sync - user not authenticated")
            return
        }

        // Stop any existing listener
        stopRealtimeSync()

        Timber.d("Starting real-time sync for user ${user.uid}")

        // Listen to all articles in user's collection
        syncListener = firestore.collection(USERS_COLLECTION)
            .document(user.uid)
            .collection(ARTICLES_COLLECTION)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (error != null) {
                    Timber.e(error, "Error listening to Firestore changes")
                    return@addSnapshotListener
                }

                if (snapshot == null || snapshot.isEmpty) {
                    Timber.d("No remote articles found")
                    return@addSnapshotListener
                }

                scope.launch {
                    try {
                        _isSyncing.value = true

                        // Process changes
                        val changes = snapshot.documentChanges
                        Timber.d("Received ${changes.size} document changes from Firestore")

                        changes.forEach { change ->
                            try {
                                val remoteArticle = change.document.toObject(Article::class.java)

                                when (change.type) {
                                    com.google.firebase.firestore.DocumentChange.Type.ADDED,
                                    com.google.firebase.firestore.DocumentChange.Type.MODIFIED -> {
                                        handleRemoteArticleChange(remoteArticle)
                                    }
                                    com.google.firebase.firestore.DocumentChange.Type.REMOVED -> {
                                        // Handle deletion if needed
                                        Timber.d("Article ${remoteArticle.itemId} removed remotely")
                                    }
                                }
                            } catch (e: Exception) {
                                Timber.e(e, "Failed to process document change")
                            }
                        }

                        _lastSyncTime.value = System.currentTimeMillis()
                    } catch (e: Exception) {
                        Timber.e(e, "Error processing Firestore snapshot")
                    } finally {
                        _isSyncing.value = false
                    }
                }
            }

        // Also schedule periodic sync for backup
        schedulePeriodicSync()
    }

    /**
     * Handle remote article change with conflict resolution
     * Uses timestamp-based last-write-wins strategy
     */
    private suspend fun handleRemoteArticleChange(remoteArticle: Article) {
        try {
            val localArticle = articleDao.getArticleById(remoteArticle.itemId)

            if (localArticle == null) {
                // New article - just insert
                articleDao.upsertArticle(remoteArticle)
                Timber.d("Inserted new article ${remoteArticle.itemId} from remote")
            } else {
                // Conflict resolution: compare timestamps
                if (shouldAcceptRemoteChange(localArticle, remoteArticle)) {
                    articleDao.upsertArticle(remoteArticle)
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
     * Push local article to Firestore
     */
    private suspend fun pushLocalArticle(article: Article) {
        val user = auth.currentUser ?: return

        try {
            firestore.collection(USERS_COLLECTION)
                .document(user.uid)
                .collection(ARTICLES_COLLECTION)
                .document(article.itemId)
                .set(article)
                .await()

            Timber.d("Pushed local article ${article.itemId} to Firestore")
        } catch (e: Exception) {
            Timber.e(e, "Failed to push article ${article.itemId}")
        }
    }

    /**
     * Sync local changes to Firestore
     * Pushes articles modified since last sync
     */
    suspend fun syncLocalChanges() {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot sync - user not authenticated")
            return
        }

        try {
            _isSyncing.value = true

            val lastSync = firestoreBackupService.getLastSyncTimestamp().getOrNull() ?: 0L

            // Get articles modified since last sync
            val modifiedArticles = if (lastSync > 0) {
                articleDao.getArticlesModifiedSince(lastSync)
            } else {
                // First sync - get all articles
                articleDao.getAllArticles()
            }

            if (modifiedArticles.isEmpty()) {
                Timber.d("No local changes to sync")
                return
            }

            Timber.d("Syncing ${modifiedArticles.size} modified articles")

            // Push changes in batches
            modifiedArticles.chunked(50).forEach { chunk ->
                firestoreBackupService.backupArticles(chunk)
            }

            // Update last sync timestamp
            firestoreBackupService.updateLastSyncTimestamp()
            _lastSyncTime.value = System.currentTimeMillis()

            Timber.d("Successfully synced local changes")
        } catch (e: Exception) {
            Timber.e(e, "Failed to sync local changes")
        } finally {
            _isSyncing.value = false
        }
    }

    /**
     * Stop real-time sync listener
     */
    fun stopRealtimeSync() {
        syncListener?.remove()
        syncListener = null
        Timber.d("Stopped real-time sync")
    }

    /**
     * Schedule periodic background sync
     */
    private fun schedulePeriodicSync() {
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
     * Perform full bidirectional sync
     * Pulls remote changes and pushes local changes
     */
    suspend fun performFullSync() {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot perform full sync - user not authenticated")
            return
        }

        try {
            _isSyncing.value = true
            Timber.d("Starting full bidirectional sync")

            // First, pull remote changes
            val remoteArticles = firestoreBackupService.restoreAllArticles().getOrNull()

            if (remoteArticles != null) {
                Timber.d("Applying ${remoteArticles.size} remote articles")
                remoteArticles.forEach { remoteArticle ->
                    handleRemoteArticleChange(remoteArticle)
                }
            }

            // Then push local changes
            syncLocalChanges()

            Timber.d("Full sync completed")
        } catch (e: Exception) {
            Timber.e(e, "Full sync failed")
        } finally {
            _isSyncing.value = false
        }
    }

    /**
     * Clean up resources
     */
    fun cleanup() {
        stopRealtimeSync()
        cancelPeriodicSync()
        scope.cancel()
    }
}
