package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
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

    override suspend fun getForegroundInfo(): ForegroundInfo =
        appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            setForeground(getForegroundInfo())

            Timber.d("Starting Firestore sync via FirestoreSyncManager")

            // Delegate to FirestoreSyncManager which handles:
            // - Chunked processing (50 articles at a time) to avoid OOM
            // - Pagination using getAllArticlesPaginated instead of loading all at once
            // - Proper memory management for large datasets
            firestoreSyncManager.syncLocalChanges()

            setProgress(workDataOf(PROGRESS to 100))

            Timber.d("Firestore sync completed successfully")

            Result.success()
        } catch (e: Exception) {
            Timber.e(e, "Firestore sync failed: ${e.message}")
            Result.failure()
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
            .build()
    }
}
