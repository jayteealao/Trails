package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

/**
 * Worker that restores articles from Firestore to local database
 * Typically used when a user signs in on a new device
 */
@HiltWorker
class FirestoreRestoreWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var firestoreBackupService: FirestoreBackupService

    @Inject
    lateinit var articleRepository: ArticleRepository

    override suspend fun getForegroundInfo(): ForegroundInfo =
        appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            setForeground(getForegroundInfo())

            Timber.d("Starting Firestore restore")

            // Restore all articles from Firestore
            val result = firestoreBackupService.restoreAllArticles()

            result.fold(
                onSuccess = { articles ->
                    if (articles.isEmpty()) {
                        Timber.d("No articles to restore from Firestore")
                        return@withContext Result.success()
                    }

                    Timber.d("Restoring ${articles.size} articles from Firestore")

                    var successCount = 0
                    var failureCount = 0

                    // Restore articles in chunks
                    articles.chunked(50).forEachIndexed { index, chunk ->
                        try {
                            // Convert Article to ArticleData format
                            val articleDataList = chunk.map { article ->
                                ArticleData(
                                    article = article,
                                    images = emptyList(), // TODO: restore images, videos, tags separately
                                    videos = emptyList(),
                                    tags = emptyList(),
                                    authors = emptyList(),
                                    domainMetadata = null
                                )
                            }

                            articleRepository.add(articleDataList)
                            successCount += chunk.size

                            val progress = ((index + 1) * 50 * 100) / articles.size
                            setProgress(workDataOf(PROGRESS to progress))

                            Timber.d("Restored chunk ${index + 1}, total: $successCount")
                        } catch (e: Exception) {
                            failureCount += chunk.size
                            Timber.e(e, "Failed to restore chunk ${index + 1}")
                        }
                    }

                    setProgress(workDataOf(PROGRESS to 100))

                    Timber.d("Firestore restore completed: $successCount succeeded, $failureCount failed")

                    Result.success(
                        workDataOf(
                            SUCCESS_COUNT to successCount,
                            FAILURE_COUNT to failureCount
                        )
                    )
                },
                onFailure = { error ->
                    Timber.e(error, "Failed to restore articles from Firestore")
                    Result.failure()
                }
            )
        } catch (e: Exception) {
            Timber.e(e, "Firestore restore failed")
            Result.failure()
        }
    }

    companion object {
        private const val PROGRESS = "PROGRESS"
        private const val SUCCESS_COUNT = "SUCCESS_COUNT"
        private const val FAILURE_COUNT = "FAILURE_COUNT"

        /**
         * Expedited one time work to restore data from Firestore
         */
        fun startUpRestoreWork() = OneTimeWorkRequestBuilder<FirestoreRestoreWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
    }
}
