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
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
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
            val result = firestoreSyncManager.fullSync()

            setProgress(workDataOf(PROGRESS to 100))

            Timber.d(
                "Firestore restore finished: ${result.status} " +
                    "(pushed=${result.pushed}, failed=${result.failed})"
            )

            result.toWorkerResult().giveUpAfter(runAttemptCount, MAX_RESTORE_ATTEMPTS)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Firestore restore failed: ${e.message}")
            Result.retry().giveUpAfter(runAttemptCount, MAX_RESTORE_ATTEMPTS)
        }
    }

    companion object {
        private const val PROGRESS = "PROGRESS"

        /**
         * Runs of one restore request before it gives up. Each run reads the whole remote
         * library, and an article that never applies has no strike counter, so the
         * request must not retry forever. The next restore request (the next sign-in or
         * manual restore) starts again from the first attempt.
         */
        internal const val MAX_RESTORE_ATTEMPTS = 5

        /**
         * Expedited one time work to restore data from Firestore
         */
        fun startUpRestoreWork() = OneTimeWorkRequestBuilder<FirestoreRestoreWorker>()
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
