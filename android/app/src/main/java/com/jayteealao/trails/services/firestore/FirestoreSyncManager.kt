package com.jayteealao.trails.services.firestore

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.common.di.ApplicationScope
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sync status for UI display
 */
sealed class SyncStatus {
    object Idle : SyncStatus()
    object Syncing : SyncStatus()
    /** A finished run; [failed] counts the articles it could not send (0 for a clean run). */
    data class Success(val message: String, val failed: Int = 0) : SyncStatus()
    data class Error(val message: String, val exception: Exception?) : SyncStatus()
}

/**
 * The constraint every sync request carries: a connected network. The workers'
 * one-time requests and the periodic request share it.
 */
internal fun syncConstraints(): Constraints =
    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

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
    @ApplicationScope private val scope: CoroutineScope,
    private val localDataOwner: LocalDataOwner,
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
        // Absolute failsafe for the reconcile drain loop, independent of the
        // row-identity stall guard (1000 iterations ≈ 20k articles per sweep).
        private const val MAX_RECONCILE_ITERATIONS = 1000
        // timeUpdated is never negative, so "changed since -1" selects every row.
        private const val PUSH_ALL_SINCE = -1L
        // Upper bound for one backup call. With offline persistence a commit waits for
        // the server instead of failing, so an unbounded call could never report.
        internal const val PUSH_TIMEOUT_MS = 120_000L
    }

    // One gate for every push, restore and wipe. The repository launches pushes directly
    // while the workers run, and overlapping runs would strike an article twice for one
    // failure; a wipe must never interleave with a run that writes the old library back.
    private val syncGate = Mutex()

    // Wipes waiting for, or holding, the gate. A restore stops at its next page while one
    // waits, so the wipe does not wait for a whole library to download.
    private val pendingWipes = AtomicInteger(0)

    /**
     * Run [block] while no push or restore runs, and start none until it returns. A
     * restore in progress stops at its next page. "Clear data" and the account-switch
     * wipe run inside it, so no run can write the cleared library back.
     */
    suspend fun <T> runExclusive(block: suspend () -> T): T {
        pendingWipes.incrementAndGet()
        try {
            return syncGate.withLock { block() }
        } finally {
            pendingWipes.decrementAndGet()
        }
    }

    /**
     * Stop a run before it writes another page: a wipe is waiting, the user changed, or
     * the user no longer owns the local library.
     */
    private fun checkStillOwnedBy(uid: String) {
        if (pendingWipes.get() > 0) throw SyncAbortedException("Local data is being cleared")
        if (auth.currentUser?.uid != uid || !localDataOwner.isOwnedBy(uid)) {
            throw SyncAbortedException("Signed-in account changed during sync")
        }
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
     * @param remoteRows Image and author rows for this article, pre-fetched by
     *   [applyRemoteArticles]. They are upserted when the remote side wins; local rows
     *   that Firestore lacks are kept.
     * @return false when applying the article failed.
     */
    private suspend fun handleRemoteArticleChange(
        remoteArticle: Article,
        prefetchedTags: List<ArticleTags>,
        remoteRows: ArticleRows = ArticleRows()
    ): Boolean {
        try {
            val localArticle = articleDao.getArticleById(remoteArticle.itemId)

            if (localArticle == null) {
                // New article - insert with related data. Stamp its sync state: the row
                // came from Firestore, so it is by definition already backed up —
                // without the stamp the next reconcile sweep re-uploads it (a billed
                // write per pulled article).
                articleDao.upsertRestoredArticle(
                    remoteArticle.copy(normalizedUrl = remoteArticle.computeNormalizedUrl()),
                    System.currentTimeMillis(),
                )

                // Apply pre-fetched tags
                if (prefetchedTags.isNotEmpty()) {
                    articleDao.insertArticleTags(prefetchedTags)
                    Timber.d("Restored ${prefetchedTags.size} tags for article ${remoteArticle.itemId}")
                }
                insertRemoteRows(remoteArticle.itemId, remoteRows)

                Timber.d("Inserted new article ${remoteArticle.itemId} from remote")
            } else {
                // Conflict resolution: compare timestamps
                if (shouldAcceptRemoteChange(localArticle, remoteArticle)) {
                    // Remote won — the applied row exactly reflects Firestore, so it
                    // is already backed up. Stamping keeps it out of the reconcile
                    // sweep (local-wins rows below stay unstamped deliberately).
                    articleDao.upsertRestoredArticle(
                        remoteArticle.copy(normalizedUrl = remoteArticle.computeNormalizedUrl()),
                        System.currentTimeMillis(),
                    )

                    // Replace tags: bulk delete (efficiency-3: N DAO calls → 1 DAO call)
                    // then insert remote tags. See ArticleDao.deleteAllTagsForArticle KDoc
                    // for the brief delete-insert window caveat.
                    articleDao.deleteAllTagsForArticle(remoteArticle.itemId)
                    if (prefetchedTags.isNotEmpty()) {
                        articleDao.insertArticleTags(prefetchedTags)
                    }
                    Timber.d("Updated ${prefetchedTags.size} tags for article ${remoteArticle.itemId}")
                    insertRemoteRows(remoteArticle.itemId, remoteRows)

                    Timber.d("Updated article ${remoteArticle.itemId} from remote (remote newer)")
                } else {
                    // Local is newer. The row stays unstamped, so the push that follows
                    // the restore sends it, with its stamp and strike accounting.
                    Timber.d("Kept local version of ${remoteArticle.itemId} (local newer)")
                }
            }
            return true
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Timber.e(e, "Failed to handle remote article ${remoteArticle.itemId}")
            return false
        }
    }

    /** Upsert the restored image, author and video rows of one article; never deletes a local row. */
    private suspend fun insertRemoteRows(itemId: String, rows: ArticleRows) {
        if (rows.isEmpty()) return
        articleDao.insertArticleRows(rows.images, rows.authors, rows.videos)
        Timber.d(
            "Restored ${rows.images.size} images, ${rows.authors.size} authors and " +
                "${rows.videos.size} videos for article $itemId"
        )
    }

    /**
     * Batch-fetch tags for all articles in [articles] then apply each article
     * to Room via [handleRemoteArticleChange].
     *
     * Tags for the whole list are fetched in one [FirestoreBackupService.batchRestoreArticleTags]
     * call (ceil(N/RESTORE_TAG_CHUNK_SIZE) parallel round-trips) rather than one
     * sequential subcollection read per article. Image and author rows follow through
     * [FirestoreBackupService.batchRestoreArticleRows], read only for the articles the
     * remote side will write (new here, or newer remote): a local-wins article does not
     * use them. An article whose rows could not be read keeps its local rows. Room
     * writes follow both fetches.
     *
     * @param articles The page of remote articles to apply.
     * @return the number of articles that failed to apply.
     */
    // internal for testability
    internal suspend fun applyRemoteArticles(articles: List<Article>): Int {
        val ids = articles.map { it.itemId }
        val tagsByArticleId = firestoreBackupService.batchRestoreArticleTags(ids)
        val localById = articleDao.getArticlesWithIds(ids).associateBy { it.itemId }
        val remoteWrites = articles.filter { remote ->
            val local = localById[remote.itemId]
            local == null || shouldAcceptRemoteChange(local, remote)
        }
        val rowsByArticleId = firestoreBackupService.batchRestoreArticleRows(remoteWrites.map { it.itemId })
        return withContext(Dispatchers.IO) {
            articles.count { article ->
                !handleRemoteArticleChange(
                    article,
                    tagsByArticleId[article.itemId] ?: emptyList(),
                    rowsByArticleId[article.itemId] ?: ArticleRows()
                )
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
     * Push one chunk of changed articles and record what happened to each.
     *
     * The chunk goes out through one [FirestoreBackupService.backupArticlesPaginated] call.
     * On success every article in it is stamped. A transient failure (see
     * [isTransientSyncFailure], or no signed-in user) stops the run with nothing recorded.
     * Any other failure retries the chunk one article at a time, so a single bad article
     * gets the strike and the others are stamped. Stamps and strikes are written in one
     * transaction ([ArticleDao.recordPushResults]).
     *
     * The stamp is the version that was sent: an article is stamped with the
     * `timeUpdated` it was read with, and only while its row still has that version
     * ([ArticleDao.recordPushResults]). An edit committed while the chunk is in flight
     * changes the version, so the row stays unsynced and the next run sends it.
     *
     * Each article's tags and image, author and video rows are loaded here and ride in its
     * batch, so the push loop, the per-article retry and the reconcile sweep all send
     * them. A failed local read stops the run with nothing recorded.
     */
    private suspend fun pushChunk(
        chunk: List<Article>,
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
    ): SyncRunResult {
        if (chunk.isEmpty()) return SyncRunResult(0, 0)
        val succeeded = mutableListOf<String>()
        val failed = mutableListOf<String>()
        var interruptedBy: Throwable? = null

        val tagsById: Map<String, List<ArticleTags>>
        val rowsById = try {
            val ids = chunk.map { it.itemId }
            tagsById = articleDao.getTagsForArticles(ids).groupBy { it.itemId }
            groupRows(
                articleDao.getImagesForArticles(ids),
                articleDao.getAuthorsForArticles(ids),
                articleDao.getVideosForArticles(ids),
            )
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            // A local read failure is not the article's fault: stop, no strike.
            Timber.e(e, "Error reading tags, image, author and video rows for a push chunk")
            return SyncRunResult(0, 0, interruptedBy = e)
        }

        val chunkError = backupWithTimeout(chunk, tagsById, rowsById, onProgress).exceptionOrNull()
        when {
            chunkError == null -> chunk.mapTo(succeeded) { it.itemId }
            isTransient(chunkError) -> {
                Timber.w(chunkError, "Push stopped by a transient failure")
                interruptedBy = chunkError
            }
            else -> {
                Timber.w(chunkError, "Chunk push failed; retrying its ${chunk.size} articles one by one")
                for (article in chunk) {
                    val tags = tagsById[article.itemId]?.let { mapOf(article.itemId to it) } ?: emptyMap()
                    val rows = rowsById.filterKeys { it == article.itemId }
                    val error = backupWithTimeout(listOf(article), tags, rows).exceptionOrNull()
                    when {
                        error == null -> succeeded += article.itemId
                        isTransient(error) -> {
                            Timber.w(error, "Push stopped by a transient failure")
                            interruptedBy = error
                            break
                        }
                        else -> {
                            Timber.e(error, "Push failed for article ${article.itemId}")
                            failed += article.itemId
                        }
                    }
                }
            }
        }

        if (succeeded.isNotEmpty() || failed.isNotEmpty()) {
            val versions = chunk.associate { it.itemId to it.timeUpdated }
            articleDao.recordPushResults(succeeded.associateWith { versions.getValue(it) }, failed)
        }
        return SyncRunResult(succeeded.size, failed.size, interruptedBy)
    }

    /**
     * Back up one article now (the save flow calls this right after a save), with its
     * tags and rows, through the same stamp as a push run. It runs only when the
     * signed-in user owns the local library, and only when no other run holds the
     * gate: a busy gate leaves the article unsynced, and the running or next push sends
     * it. A failure here gives the article no strike; push runs count those.
     */
    suspend fun backupArticleNow(itemId: String): Result<Unit> {
        if (!syncGate.tryLock()) {
            return Result.failure(IllegalStateException("A sync is running; the next push sends $itemId"))
        }
        try {
            val user = auth.currentUser
                ?: return Result.failure(IllegalStateException("Not authenticated"))
            if (!localDataOwner.isOwnedBy(user.uid)) {
                return Result.failure(SyncAbortedException("Signed-in user does not own the local data"))
            }
            val article = articleDao.getArticleById(itemId)
                ?: return Result.failure(NoSuchElementException("Article $itemId not found locally"))
            val ids = listOf(itemId)
            val tags = articleDao.getTagsForArticles(ids).groupBy { it.itemId }
            val rows = groupRows(
                articleDao.getImagesForArticles(ids),
                articleDao.getAuthorsForArticles(ids),
                articleDao.getVideosForArticles(ids),
            )
            val error = backupWithTimeout(listOf(article), tags, rows).exceptionOrNull()
            if (error != null) return Result.failure(error)
            articleDao.recordPushResults(mapOf(itemId to article.timeUpdated), emptyList())
            return Result.success(Unit)
        } finally {
            syncGate.unlock()
        }
    }

    /** A failure that says nothing about the article: retry the run later, no strike. */
    private fun isTransient(error: Throwable): Boolean =
        auth.currentUser == null || error.isTransientSyncFailure()

    /**
     * One backup call bounded by [PUSH_TIMEOUT_MS]; a call that runs out of time fails
     * with [SyncTimeoutException].
     */
    private suspend fun backupWithTimeout(
        articles: List<Article>,
        tagsById: Map<String, List<ArticleTags>>,
        rowsById: Map<String, ArticleRows>,
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
    ): Result<Int> {
        val result = withTimeoutOrNull(PUSH_TIMEOUT_MS) {
            firestoreBackupService.backupArticlesPaginated(articles, tagsById, onProgress, rowsById)
        } ?: return Result.failure(SyncTimeoutException(PUSH_TIMEOUT_MS))
        // The backup service catches every exception, the timeout's cancellation included.
        // When this coroutine is still active, that cancellation was our timeout.
        if (result.exceptionOrNull() is CancellationException) {
            currentCoroutineContext().ensureActive()
            return Result.failure(SyncTimeoutException(PUSH_TIMEOUT_MS))
        }
        return result
    }

    /**
     * Sync local changes to Firestore. Callers that need the outcome use [pushLocalChanges].
     */
    suspend fun syncLocalChanges() {
        pushLocalChanges()
    }

    /**
     * Push articles changed since the last sync (all articles on a first sync), in chunks
     * to avoid OutOfMemoryError with large datasets, and report what happened.
     *
     * Each pushed article is stamped as backed up; an article whose push fails for a
     * reason of its own gets a strike, and after MAX_SYNC_FAILURES strikes the queries
     * skip it. A transient failure stops the run. Last sync moves to the run's start
     * time only when the run is [SyncRunStatus.SUCCESS]. Safe to call while a worker runs.
     */
    suspend fun pushLocalChanges(): SyncRunResult = syncGate.withLock { pushLocalChangesLocked() }

    private suspend fun pushLocalChangesLocked(): SyncRunResult {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot sync - user not authenticated")
            _syncStatus.value = SyncStatus.Error("Not authenticated", null)
            return SyncRunResult(0, 0, noUser = true)
        }
        // First check after the user: the local rows belong to another account, which
        // this user must never receive. Nothing is read before this point.
        if (!localDataOwner.isOwnedBy(user.uid)) {
            Timber.w("Sync skipped: signed-in user does not own the local data")
            return SyncRunResult(0, 0, noUser = true)
        }

        val runStartedAt = System.currentTimeMillis()
        var result = SyncRunResult(0, 0)
        try {
            _isSyncing.value = true
            _syncStatus.value = SyncStatus.Syncing
            _lastError.value = null

            // Single user-meta read covers both isFirstSync and lastSyncTimestamp (efficiency-1).
            // A failed read stops the run: without last sync the run cannot know what to push.
            val metaResult = firestoreBackupService.getUserMetaSnapshot()
            val meta = metaResult.getOrNull()
            if (meta == null) {
                val error = metaResult.exceptionOrNull() ?: IllegalStateException("No user meta")
                Timber.w(error, "Cannot sync - user meta read failed")
                result = SyncRunResult(0, 0, interruptedBy = error)
                reportPushStatus(result, isFirstSync = false)
                return result
            }
            val isFirstSync = meta.isFirstSync
            val lastSync = meta.lastSyncTimestamp ?: 0L

            // One "since" value for every branch, so the count and the pages agree and
            // deleted rows (tombstones) are pushed on a first sync as well. Last sync is
            // account-wide (another device moves it), so it never decides which rows are
            // unsent: after a first sync a run selects every row whose current version
            // this device has not backed up, however old the edit.
            if (isFirstSync) {
                Timber.d("First sync detected - counting all existing articles")
            }
            val pushSince = if (!isFirstSync && lastSync > 0) lastSync else PUSH_ALL_SINCE

            // A row changed after the run started is left to the next run.
            val totalCount = articleDao.countArticlesModifiedSince(pushSince, runStartedAt)

            if (totalCount == 0) {
                Timber.d("No local changes to sync")

                // Offline-saved articles are invisible to the incremental count
                // (no backed-up stamp in sync_state, but timeUpdated predates lastSync), so the
                // safety-net sweep must run even when there is nothing else to push.
                result += reconcileNeverBackedUpArticles()

                // Last sync moves when nothing is left to push and something changed since
                // it (an earlier run sent it), or on a first sync; an idle run writes nothing.
                if (result.status == SyncRunStatus.SUCCESS &&
                    (isFirstSync || articleDao.countArticlesChangedInWindow(pushSince, runStartedAt) > 0)
                ) {
                    result += recordLastSync(runStartedAt)
                }
                if (result.status == SyncRunStatus.SUCCESS) {
                    _syncStatus.value = SyncStatus.Success("Up to date")
                } else {
                    reportPushStatus(result, isFirstSync)
                }
                return result
            }

            Timber.d("Syncing $totalCount articles with related data (firstSync=$isFirstSync)")

            // Adaptive chunk size: larger for first sync to reduce API calls
            val chunkSize = if (isFirstSync && totalCount > 1000) {
                200 // Larger chunks for big initial syncs
            } else {
                50  // Smaller chunks for regular syncs
            }

            // Keyset pages in (timeUpdated, itemId) order: each page starts after the last
            // row read, so a row that changes or drops out during the run shifts no page.
            var afterTime = PUSH_ALL_SINCE
            var afterId = ""
            var read = 0
            while (true) {
                // A waiting wipe ends the run between chunks; what is left stays unsynced.
                if (pendingWipes.get() > 0) {
                    result += SyncRunResult(0, 0, interruptedBy = SyncAbortedException("Local data is being cleared"))
                    break
                }
                val chunk: List<Article>
                try {
                    chunk = articleDao.getArticlesModifiedSinceKeyset(pushSince, runStartedAt, afterTime, afterId, chunkSize)
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    // A local read failure is not the article's fault: stop, no strike.
                    Timber.e(e, "Error reading chunk after $read articles")
                    result += SyncRunResult(0, 0, interruptedBy = e)
                    break
                }
                if (chunk.isEmpty()) break

                val readBefore = read
                val chunkResult = pushChunk(chunk) { current, _ ->
                    _syncStatus.value = SyncStatus.Syncing
                    Timber.d("Syncing ${readBefore + current} / $totalCount articles")
                }
                result += chunkResult
                if (chunkResult.interruptedBy != null) break

                read += chunk.size
                afterTime = chunk.last().timeUpdated
                afterId = chunk.last().itemId
                if (chunk.size < chunkSize) break
            }

            // Class-B reconciliation sweep: back up any article that was saved locally
            // but never reached Firestore (no backed-up stamp in sync_state). These are
            // articles that were saved offline, had an inline backup failure, or pre-date
            // the backed-up stamp. It runs only after a clean loop, so an article gets
            // at most one strike per run.
            if (result.failed == 0 && result.interruptedBy == null) {
                result += reconcileNeverBackedUpArticles()
            }

            // Last sync moves only when every attempted article reached Firestore.
            if (result.status == SyncRunStatus.SUCCESS) {
                result += recordLastSync(runStartedAt)
            }

            reportPushStatus(result, isFirstSync)
            Timber.d("Push run finished: ${result.status} (pushed=${result.pushed}, failed=${result.failed})")
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            Timber.e(e, "Failed to sync local changes")
            result += SyncRunResult(0, 0, interruptedBy = e)
            _lastError.value = e.message ?: "Sync failed"
            _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
        } finally {
            _isSyncing.value = false
        }
        return result
    }

    /**
     * Write the last-sync timestamp [at] and mirror it in [lastSyncTime]. A failed
     * write is a transient failure of the run.
     */
    private suspend fun recordLastSync(at: Long): SyncRunResult {
        val error = firestoreBackupService.updateLastSyncTimestamp(at).exceptionOrNull()
        if (error != null) {
            Timber.w(error, "Failed to record last sync")
            return SyncRunResult(0, 0, interruptedBy = error)
        }
        _lastSyncTime.value = at
        return SyncRunResult(0, 0)
    }

    /** Set [syncStatus] for a finished push run, keeping the existing wording. */
    private fun reportPushStatus(result: SyncRunResult, isFirstSync: Boolean) {
        val interruptedBy = result.interruptedBy
        if (interruptedBy != null) {
            // An interrupted run is not a clean sync, even when it pushed some articles:
            // last sync did not move and the worker retries, so report an error.
            val reason = interruptedBy.message ?: "Unknown error"
            val message = if (result.pushed == 0 && result.failed == 0) {
                reason
            } else {
                "Synced ${result.pushed} articles, ${result.failed} failed, then stopped: $reason"
            }
            _lastError.value = reason
            _syncStatus.value = SyncStatus.Error(message, interruptedBy as? Exception)
            return
        }
        val message = if (result.failed > 0) {
            "Synced ${result.pushed} articles, ${result.failed} failed"
        } else if (isFirstSync) {
            "Initial backup complete: ${result.pushed} articles"
        } else {
            "Synced ${result.pushed} articles"
        }
        _syncStatus.value = SyncStatus.Success(message, failed = result.failed)
    }

    /**
     * The periodic sync request: every 15 minutes, on a connected network, with
     * exponential backoff when the worker asks for a retry.
     */
    internal fun periodicSyncRequest(): PeriodicWorkRequest =
        PeriodicWorkRequestBuilder<FirestoreSyncWorker>(
            15, TimeUnit.MINUTES // Sync every 15 minutes
        )
            .setConstraints(syncConstraints())
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.DEFAULT_BACKOFF_DELAY_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()

    /**
     * Schedule periodic background sync
     * Should be called after WorkManager is fully initialized
     */
    fun schedulePeriodicSync() {
        // UPDATE applies the current request spec (constraint, backoff) to devices that
        // already have the periodic work, without resetting its schedule.
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(
                SYNC_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                periodicSyncRequest()
            )
    }

    /**
     * Cancel periodic sync
     */
    fun cancelPeriodicSync() {
        WorkManager.getInstance(context).cancelUniqueWork(SYNC_WORK_NAME)
    }

    /**
     * Perform full bidirectional sync. Callers that need the outcome use [fullSync].
     */
    suspend fun performFullSync() {
        fullSync()
    }

    /**
     * Perform full bidirectional sync with pagination, and report what happened.
     * Intelligently handles first sync scenarios:
     * - New device with remote data → restore only
     * - Existing user upgrading → backup only
     * - Both have data → bidirectional sync
     *
     * A failed restore, or a remote article that fails to apply, makes the run fail;
     * otherwise the result is the push result.
     */
    suspend fun fullSync(): SyncRunResult = syncGate.withLock { fullSyncLocked() }

    private suspend fun fullSyncLocked(): SyncRunResult {
        val user = auth.currentUser
        if (user == null) {
            Timber.w("Cannot perform full sync - user not authenticated")
            _syncStatus.value = SyncStatus.Error("Not authenticated", null)
            return SyncRunResult(0, 0, noUser = true)
        }
        // Same guard as the push: neither push nor restore mixes two accounts' libraries.
        if (!localDataOwner.isOwnedBy(user.uid)) {
            Timber.w("Sync skipped: signed-in user does not own the local data")
            return SyncRunResult(0, 0, noUser = true)
        }

        var result = SyncRunResult(0, 0)
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
                // A failed count read stops the run, as a failed meta read does: read as
                // zero it would take the "no data on either side" path and use up the
                // first sync without restoring anything.
                val remoteCountResult = firestoreBackupService.getRemoteArticleCount()
                val remoteCount = remoteCountResult.getOrNull()
                if (remoteCount == null) {
                    val error = remoteCountResult.exceptionOrNull()
                        ?: IllegalStateException("Remote article count unavailable")
                    Timber.w(error, "Cannot sync - remote article count read failed")
                    reportRunFailure(error)
                    return SyncRunResult(0, 0, interruptedBy = error)
                }

                Timber.d("First sync counts - Local: $localCount, Remote: $remoteCount")

                when {
                    localCount > 0 && remoteCount == 0 -> {
                        // Scenario 1: Existing user upgrading - backup local data
                        Timber.d("First sync: Backup scenario (existing user upgrading)")
                        _syncStatus.value = SyncStatus.Syncing
                        result = pushLocalChangesLocked() // This will backup all local articles
                    }
                    localCount == 0 && remoteCount > 0 -> {
                        // Scenario 2: New device - restore from remote
                        Timber.d("First sync: Restore scenario (new device with remote data)")
                        _syncStatus.value = SyncStatus.Syncing

                        // A failed restore sets the error status itself.
                        result = restoreRemoteArticles(user.uid)
                        if (result.interruptedBy == null) {
                            // Mark as synced only when every remote article applied.
                            if (result.failed == 0) {
                                result += recordLastSync(System.currentTimeMillis())
                            }
                            val interruptedBy = result.interruptedBy
                            when {
                                result.status == SyncRunStatus.SUCCESS ->
                                    _syncStatus.value = SyncStatus.Success("Restored $remoteCount articles")
                                interruptedBy != null -> reportRunFailure(interruptedBy)
                                else -> _syncStatus.value = SyncStatus.Success(
                                    "Restored ${remoteCount - result.failed} articles, ${result.failed} failed"
                                )
                            }
                        }
                    }
                    localCount > 0 && remoteCount > 0 -> {
                        // Scenario 3: Both have data - full bidirectional sync
                        Timber.d("First sync: Bidirectional scenario (both have data)")
                        result = performBidirectionalSync(user.uid)
                    }
                    else -> {
                        // Scenario 4: Neither has data - just mark as synced
                        Timber.d("First sync: No data on either side")
                        result = recordLastSync(System.currentTimeMillis())
                        val interruptedBy = result.interruptedBy
                        if (interruptedBy == null) {
                            _syncStatus.value = SyncStatus.Success("Up to date")
                        } else {
                            reportRunFailure(interruptedBy)
                        }
                    }
                }
            } else {
                // Regular sync - always bidirectional
                Timber.d("Regular sync - performing bidirectional sync")
                result = performBidirectionalSync(user.uid)
            }

            Timber.d("Full sync finished: ${result.status} (pushed=${result.pushed}, failed=${result.failed})")
        } catch (e: Exception) {
            // Re-throw CancellationException so structured concurrency propagates correctly
            // (review fix RE-1).
            if (e is CancellationException) throw e
            Timber.e(e, "Full sync failed: ${e.message}")
            result += SyncRunResult(0, 0, interruptedBy = e)
            _lastError.value = e.message ?: "Full sync failed"
            _syncStatus.value = SyncStatus.Error(e.message ?: "Unknown error", e)
        } finally {
            _isSyncing.value = false
        }
        return result
    }

    /**
     * Pull every remote article page by page, writing each page to Room on arrival.
     * A failed restore interrupts the run and sets [syncStatus] to an error; remote
     * articles that fail to apply are counted as failed. Each page is written only while
     * [uid] is still the signed-in owner and no wipe waits ([checkStillOwnedBy]).
     */
    private suspend fun restoreRemoteArticles(uid: String): SyncRunResult {
        var failedApplies = 0
        val restoreError = firestoreBackupService.restoreAllArticlesPaginated(
            onProgress = { current, total ->
                _syncStatus.value = SyncStatus.Syncing
                Timber.d("Restoring $current / $total articles")
            },
            onPage = { pageArticles ->
                checkStillOwnedBy(uid)
                failedApplies += applyRemoteArticles(pageArticles)
            }
        ).exceptionOrNull()
        if (restoreError != null) {
            Timber.e(restoreError, "Failed to restore remote articles")
            reportRunFailure(restoreError)
            return SyncRunResult(0, failedApplies, interruptedBy = restoreError)
        }
        return SyncRunResult(0, failedApplies)
    }

    /** Report a run that stopped on [error], as a thrown run did. */
    private fun reportRunFailure(error: Throwable) {
        _lastError.value = error.message ?: "Full sync failed"
        _syncStatus.value = SyncStatus.Error(error.message ?: "Unknown error", error as? Exception)
    }

    /**
     * Perform bidirectional sync (pull remote, push local)
     */
    private suspend fun performBidirectionalSync(uid: String): SyncRunResult {
        // First, pull remote changes with pagination — each page written to Room on arrival.
        val restore = restoreRemoteArticles(uid)
        if (restore.interruptedBy != null) return restore

        // Then push local changes with pagination (the gate is already held).
        return restore + pushLocalChangesLocked()
    }

    /**
     * Back up articles that were saved locally but never successfully backed up to
     * Firestore (no [com.jayteealao.trails.data.local.database.SyncState] stamp). This handles:
     * - Articles saved while offline (inline backup failed silently).
     * - Articles saved before the backed-up stamp existed (no stamp by default).
     * - The live Class-B case (e.g. `XrU724etfGYUZ9`) that stranded ~18h without archives.
     *
     * Processes in pages of [RECONCILE_CHUNK_SIZE] to respect the Firestore rules
     * document-access budget (≤ 20 getAfter calls per batched write).
     */
    // internal for testability
    internal suspend fun reconcileNeverBackedUpArticles(): SyncRunResult {
        if (auth.currentUser == null) return SyncRunResult(0, 0)
        val backlog = articleDao.countArticlesNeverBackedUp()
        if (backlog > 0) {
            Timber.d("reconcile: starting sweep, $backlog never-backed-up articles")
        }
        var total = SyncRunResult(0, 0)
        var prevChunkIds: Set<String> = emptySet()
        var iterations = 0
        while (true) {
            if (iterations++ >= MAX_RECONCILE_ITERATIONS) {
                Timber.w("reconcile: iteration cap $MAX_RECONCILE_ITERATIONS hit, stopping sweep — work may remain")
                break
            }
            // Always the first page: stamping sync_state removes rows from the
            // never-backed-up predicate, so the next first page is
            // always the next unswept batch.
            val chunk = articleDao.getArticlesNeverBackedUp(RECONCILE_CHUNK_SIZE)
            if (chunk.isEmpty()) break
            // Stall guard: the same rows coming back means stamping is not removing
            // them from the predicate. Consecutive full pages of *different* rows are
            // normal progress — comparing sizes here (the old guard) misfires on any
            // backlog larger than one chunk.
            val chunkIds = chunk.mapTo(mutableSetOf()) { it.itemId }
            if (chunkIds == prevChunkIds) {
                Timber.w("reconcile: same ${chunk.size} rows returned twice, stopping sweep")
                break
            }
            prevChunkIds = chunkIds
            // Same per-article path as the push loop: stamps on success and strikes on an
            // article's own failure, in one transaction.
            val result = pushChunk(chunk)
            total += result
            if (result.failed > 0 || result.interruptedBy != null) {
                Timber.w(result.interruptedBy, "reconcile: chunk did not fully back up, stopping sweep")
                break
            }
            Timber.d("reconcile: swept ${result.pushed} articles (total so far: ${total.pushed})")
        }
        if (total.pushed > 0) {
            Timber.d("reconcile: finished, swept ${total.pushed} never-backed-up articles")
        }
        return total
    }

    /**
     * Clean up resources
     */
    fun cleanup() {
        cancelPeriodicSync()
        // scope is an @ApplicationScope @Singleton — do NOT cancel it here; it is app-lifetime managed
    }
}
