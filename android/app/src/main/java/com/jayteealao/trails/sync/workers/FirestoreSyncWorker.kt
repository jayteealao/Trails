package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkRequest
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunStatus
import com.jayteealao.trails.services.firestore.syncConstraints
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Worker that syncs local articles to Firestore for backup
 * Delegates to FirestoreSyncManager which handles chunked processing to avoid OOM
 */
@HiltWorker
class FirestoreSyncWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var firestoreSyncManager: FirestoreSyncManager

    /**
     * Gives recently saved articles their lead-image and byline rows once Warg has
     * archived them, without the person opening the article. Null where no injector
     * sets it (worker tests); the sync itself does not depend on it.
     */
    @Inject
    @JvmField
    var archiveService: ArchiveService? = null

    override suspend fun getForegroundInfo(): ForegroundInfo =
        appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            setForeground(getForegroundInfo())

            Timber.d("Starting Firestore sync via FirestoreSyncManager")

            // Delegate to FirestoreSyncManager which handles:
            // - Chunked processing (50 articles at a time) to avoid OOM
            // - Keyset pages of the run window via getArticlesModifiedSinceKeyset
            //   (deleted rows included) instead of loading all at once
            // - Proper memory management for large datasets
            val result = firestoreSyncManager.pushLocalChanges()
            if (result.status != SyncRunStatus.NO_USER) applyMissingWargMetadata()

            setProgress(workDataOf(PROGRESS to 100))

            Timber.d(
                "Firestore sync finished: ${result.status} " +
                    "(pushed=${result.pushed}, failed=${result.failed})"
            )

            result.toWorkerResult()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Firestore sync failed: ${e.message}")
            Result.retry()
        }
    }

    /** Rows written here raise the article's timeUpdated, so the next run pushes them. */
    private suspend fun applyMissingWargMetadata() {
        try {
            archiveService?.applyMissingWargMetadata()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "Background metadata pass failed")
        }
    }

    companion object {
        private const val PROGRESS = "PROGRESS"
        private const val SUCCESS_COUNT = "SUCCESS_COUNT"
        private const val FAILURE_COUNT = "FAILURE_COUNT"

        /**
         * Expedited one time work to sync data to Firestore
         */
        fun startUpSyncWork() = OneTimeWorkRequestBuilder<FirestoreSyncWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setConstraints(syncConstraints())
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.DEFAULT_BACKOFF_DELAY_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()
    }
}
