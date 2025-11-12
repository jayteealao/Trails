package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

/**
 * Worker that syncs local articles to Firestore for backup
 * Backs up articles for the currently authenticated user
 */
@HiltWorker
class FirestoreSyncWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var firestoreBackupService: FirestoreBackupService

    @Inject
    lateinit var articleDao: ArticleDao

    override suspend fun getForegroundInfo(): ForegroundInfo =
        appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            setForeground(getForegroundInfo())

            // Get all articles that need to be backed up
            // You can customize this to only backup articles modified since last sync
            val articles = articleDao.getAllArticles()

            if (articles.isEmpty()) {
                Timber.d("No articles to backup")
                return@withContext Result.success()
            }

            Timber.d("Starting Firestore backup for ${articles.size} articles")

            // Backup articles in chunks
            var successCount = 0
            var failureCount = 0

            articles.chunked(50).forEachIndexed { index, chunk ->
                try {
                    val result = firestoreBackupService.backupArticles(chunk)
                    result.fold(
                        onSuccess = { count ->
                            successCount += count
                            val progress = ((index + 1) * 50 * 100) / articles.size
                            setProgress(workDataOf(PROGRESS to progress))
                            Timber.d("Backed up chunk ${index + 1}, total: $successCount")
                        },
                        onFailure = { error ->
                            failureCount += chunk.size
                            Timber.e(error, "Failed to backup chunk ${index + 1}")
                        }
                    )
                } catch (e: Exception) {
                    failureCount += chunk.size
                    Timber.e(e, "Exception backing up chunk ${index + 1}")
                }
            }

            // Update last sync timestamp
            firestoreBackupService.updateLastSyncTimestamp()

            setProgress(workDataOf(PROGRESS to 100))

            Timber.d("Firestore backup completed: $successCount succeeded, $failureCount failed")

            if (failureCount > 0 && successCount == 0) {
                Result.failure()
            } else {
                Result.success(
                    workDataOf(
                        SUCCESS_COUNT to successCount,
                        FAILURE_COUNT to failureCount
                    )
                )
            }
        } catch (e: Exception) {
            Timber.e(e, "Firestore sync failed")
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
