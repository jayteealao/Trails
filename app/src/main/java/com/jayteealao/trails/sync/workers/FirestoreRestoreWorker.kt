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
 * Worker that restores articles from Firestore to local database
 * Delegates to FirestoreSyncManager which handles pagination to avoid OOM
 * Typically used when a user signs in on a new device
 */
@HiltWorker
class FirestoreRestoreWorker @AssistedInject constructor(
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

            Timber.d("Starting Firestore restore via FirestoreSyncManager")

            // Delegate to FirestoreSyncManager which handles:
            // - Pagination (loads articles in chunks to avoid OOM)
            // - Conflict resolution (merges local + remote data)
            // - First-sync detection (determines sync strategy)
            // - Progress tracking via StateFlow
            firestoreSyncManager.performFullSync()

            setProgress(workDataOf(PROGRESS to 100))

            Timber.d("Firestore restore completed successfully")

            Result.success()
        } catch (e: Exception) {
            Timber.e(e, "Firestore restore failed: ${e.message}")
            Result.failure()
        }
    }

    companion object {
        private const val PROGRESS = "PROGRESS"

        /**
         * Expedited one time work to restore data from Firestore
         */
        fun startUpRestoreWork() = OneTimeWorkRequestBuilder<FirestoreRestoreWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
    }
}
