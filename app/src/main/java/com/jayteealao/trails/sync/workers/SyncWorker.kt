@file:OptIn(ExperimentalCoroutinesApi::class)

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
import com.jayteealao.trails.data.datasource.NetworkDataSource
import com.jayteealao.trails.network.PocketData
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import com.jayteealao.trails.usecases.GetAccessTokenFromLocalUseCase
import com.jayteealao.trails.usecases.GetSinceFromLocalUseCase
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.channels.produce
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject


/**
 * Syncs the data layer by delegating to the appropriate repository instances with
 * sync functionality.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase
    @Inject
    lateinit var articleRepository: ArticleRepository
    @Inject
    lateinit var getSinceFromLocalUseCase: GetSinceFromLocalUseCase
    @Inject
    lateinit var networkDataSource: NetworkDataSource

    override suspend fun getForegroundInfo(): ForegroundInfo = appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO){
        val syncJob: Job?

        setForeground(getForegroundInfo())

            appContext.awaitAccessPermission(getAccessTokenFromLocalUseCase)
            syncJob = launch(Dispatchers.IO) {
                producePocketArticles()
                    .let { receiveArticles ->
                        repeat(10) { no ->
                            articleSaver(no, receiveArticles)
                        }
                    }
            }

            delay(1000)
            while (syncJob.isActive) {
                setProgress(workDataOf(PROGRESS to 0))
                delay(1000)
            }

            setProgress(workDataOf(PROGRESS to 100))
            if (syncJob.isCancelled) {
                return@withContext Result.failure()
            }
            Result.success()

    }

    internal companion object {
        /**
         * Expedited one time work to sync data on app startup.
         */
        internal fun startUpSyncWork() = OneTimeWorkRequestBuilder<SyncWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
//            .setConstraints(constraints)
            .build()

        private const val PROGRESS = "PROGRESS"

        private const val ARTICLE_LIMIT = 100
    }

    /**
     * A coroutine producer channel that retrieves articles from the Pocket API in batches of [ARTICLE_LIMIT].
     *
     * This function retrieves articles from the network data source, sending them in batches to the returned channel.
     * It uses the `since` parameter to retrieve articles modified since the last update time, fetched from the `articleRepository`.
     *
     * @return A `ReceiveChannel<List<PocketData>>` that emits lists of PocketData.
     *  * Each list contains a batch of articles (up to [ARTICLE_LIMIT]).
     *  * The channel is closed when there are no more articles to retrieve.
     *
     * @throws [RuntimeException] if an error occurs during article retrieval. This is a temporary placeholder and should be replaced with more specific error handling.
     */
    private fun CoroutineScope.producePocketArticles() = produce {
//        val since = getSinceFromLocalUseCase()
        val since = articleRepository.getLastUpdatedArticleTime()
        var offset = 0
        val next = true
        while (next) {
            val articleList: MutableList<PocketData> = networkDataSource(
                since, ARTICLE_LIMIT, offset
            )
            if (articleList.isNotEmpty()) {
                send(articleList)
                Timber.d("Sent ${articleList.size} articles, offset: $offset")
                offset += ARTICLE_LIMIT - 1
            } else {
//                next = false
                Timber.d("No more articles")
                break
                // handle error
//                    throw RuntimeException("Failed to retrieve articles: ${response. .errorBody()?.string()}")
            }
        }
        Timber.d("Closing channel")
        close()
//        articleList.clear()
    }


    /**
     * A coroutine consumer channel that receives articles from a producer channel
     * and saves the articles to the local database
     * @param receiveArticles ReceiveChannel<PocketData>
     *     a channel that emits a PocketData with article text retrieved
     *     the channel is closed when there are no more articles to retrieve
     *
     * TODO: handle error
     */
//    context(PocketRepository)
    private fun CoroutineScope.articleSaver(no: Int, receiveArticles: ReceiveChannel<MutableList<PocketData>>) =
        launch(Dispatchers.IO) {
            for (msg in receiveArticles) {
                Timber.d("articleSaver: $no Saving ${msg.size} articles")
                articleRepository.add(msg)
                Timber.d("articleSaver: $no Saved ${msg.size} articles")
                msg.clear()
            }
        }
}

private suspend fun Context.awaitAccessPermission(getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase) {
    while (currentCoroutineContext().isActive) {
        try {
            val getAccessToken = getAccessTokenFromLocalUseCase().firstOrNull()
            if (getAccessToken != null) {
            return
            }
        } catch (e: Exception) {
            Timber.e(e)
        }
    }
}
