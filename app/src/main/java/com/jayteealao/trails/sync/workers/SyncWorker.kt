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
import com.jayteealao.trails.data.PocketRepository
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
    lateinit var pocketRepository: PocketRepository
    @Inject
    lateinit var getSinceFromLocalUseCase: GetSinceFromLocalUseCase
    @Inject
    lateinit var networkDataSource: NetworkDataSource

    override suspend fun getForegroundInfo(): ForegroundInfo = appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO){
        val syncJob: Job?

        setForeground(getForegroundInfo())
        appContext.awaitAccessPermission(getAccessTokenFromLocalUseCase)
        syncJob = launch {
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
            .build()

        private const val PROGRESS = "PROGRESS"

        private const val ARTICLE_LIMIT = 100
    }

    /**
     * A coroutine producer channel that retrieves articles from Pocket API in batches
     * of 100 articles
     * @return ReceiveChannel<Array<PocketData>>
     *     a channel that emits an array of PocketData
     *     each array contains 100 articles
     *     the channel is closed when there are no more articles to retrieve
     *     or when an error occurs
     *     TODO: handle error
     *     TODO: handle empty response
     *     TODO: handle no more articles
     *     TODO: handle rate limit
     *     TODO: handle network error
     *
     */
    private fun CoroutineScope.producePocketArticles() = produce<MutableList<PocketData>> {
        val since = getSinceFromLocalUseCase()
        var offset = 0
        var next = true
        while (next) {
            val response = networkDataSource(
                since, ARTICLE_LIMIT, offset
            )
            if (response.isNotEmpty()) {
                send(response)
                Timber.d("Sent ${response.size} articles, offset: $offset")
                offset += ARTICLE_LIMIT
            } else {
                next = false
                Timber.d("No more articles")
                // handle error
//                    throw RuntimeException("Failed to retrieve articles: ${response. .errorBody()?.string()}")
            }
        }
        Timber.d("Closing channel")
        close()
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
    private fun CoroutineScope.articleSaver(no: Int, receiveArticles: ReceiveChannel<List<PocketData>>) =
        launch {
            for (msg in receiveArticles) {
                pocketRepository.add(msg)
                Timber.d("articleSaver: $no Saved ${msg.size} articles")
            }
        }
}

private suspend fun Context.awaitAccessPermission(getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase) {
    while (currentCoroutineContext().isActive) {
        val getAccessToken = getAccessTokenFromLocalUseCase().firstOrNull()
        if (getAccessToken != null) {
            return
        }
    }
}
