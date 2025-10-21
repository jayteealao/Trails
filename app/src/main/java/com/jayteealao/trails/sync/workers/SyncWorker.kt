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
import com.jayteealao.trails.common.ContentMetricsCalculator
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.datasource.NetworkDataSource
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.services.jina.JinaClient
import com.jayteealao.trails.services.supabase.SupabaseService
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import com.jayteealao.trails.sync.workers.SyncWorker.Companion.ARTICLE_LIMIT
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
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.saket.unfurl.Unfurler
import timber.log.Timber
import javax.inject.Inject
import java.util.concurrent.TimeUnit


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
    @Inject
    lateinit var supabaseService: SupabaseService
    @Inject
    lateinit var articleDao: ArticleDao
    @Inject
    lateinit var contentMetricsCalculator: ContentMetricsCalculator
    @Inject
    lateinit var jinaClient: JinaClient
    @Inject
    lateinit var postgrestClient: PostgrestClient

    val unfurler = Unfurler()

    override suspend fun getForegroundInfo(): ForegroundInfo = appContext.syncForegroundInfo()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO){
        val syncJob: Job?
        var hadErrors = false


//        val yesterday = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(1)
//        articleDao.backfillZeroTimestamps(yesterday)

        setForeground(getForegroundInfo())
            syncJob = launch(Dispatchers.IO) {
                setProgress(workDataOf(PROGRESS to 0))
                try {
//TODO: use channels
                val repopulateJob = launch {
                    val nonMetricsArticles = articleDao.getNonMetricsArticles() //TODO: replace jina
                    if (nonMetricsArticles.isNotEmpty()) {
                        Timber.d("Processing ${nonMetricsArticles.size} non-metrics articles")

                        val jobs = nonMetricsArticles.map { article ->
                            launch(Dispatchers.IO) {
                                try {
                                    if (article.title.isBlank()) {
                                        val result = unfurler.unfurl(article.url ?: article.givenUrl!!)
                                        articleDao.updateUnfurledDetails(
                                            itemId = article.itemId,
                                            title = result?.title ?: article.title,
                                            url = (result?.url ?: article.url).toString(),
                                            image = if (result?.thumbnail == null) article.image else result.thumbnail.toString(),
                                            hasImage = result?.thumbnail != null,
                                            excerpt = if (article.excerpt.isNullOrBlank()) result?.description ?: "" else article.excerpt
                                        )
                                    }
                                    if (article.text.isNullOrBlank()) {
                                        val jinaReader = jinaClient.getReader(article.url ?: article.givenUrl!!)
                                        val jinaResult = jinaReader?.data?.content
                                        if (!jinaResult.isNullOrBlank()) {
                                            articleDao.updateText(article.itemId, jinaResult)
                                            val metrics = contentMetricsCalculator.calculateMetrics(jinaResult)
                                            articleDao.updateArticleMetrics(article.itemId, metrics.readingTimeMinutes, metrics.listeningTimeMinutes, metrics.wordCount)
                                        }
                                    } else {
                                        val metrics = contentMetricsCalculator.calculateMetrics(article.text ?: "")
                                        articleDao.updateArticleMetrics(
                                            article.itemId,
                                            metrics.readingTimeMinutes,
                                            metrics.listeningTimeMinutes,
                                            metrics.wordCount
                                        )
                                    }
                                } catch (e: Exception) {
                                    Timber.e(e, "Failed to process article ${article.itemId}")
                                }
                            }
                        }

                        // Wait for all article processing to complete before moving to unresolved articles
                        jobs.joinAll()
                        Timber.d("Finished processing non-metrics articles")
                    }

/*                    var currentChunk: List<Article>
                    var offset = 0
                    val chunkSize = 50
                    Timber.d("Starting repopulation")
                    Timber.d("Total articles to repopulate: ${articleDao.countArticle()}")
                    do {
                        currentChunk = articleDao.getArticles(offset, chunkSize)
                        //if foreground service is killed, the job is cancelled
                        if (!currentCoroutineContext().isActive or foregroundInfoAsync.isCancelled) {
                            Timber.d("Job cancelled, stopping repopulation")
                            break
                        }
                        if (currentChunk.isNotEmpty()) {
                            try {
                                val response = postgrestClient.sendArticles(currentChunk)
                                Timber.d("Response: $response")
                            } catch (e: Exception) {
                                Timber.e(e, "Failed to send articles")
                            }
                            offset += chunkSize
                            Timber.d("Sent ${currentChunk.size} articles, offset: $offset")
                        }
                    } while (currentChunk.isNotEmpty())
                    Timber.d("Repopulation done")*/

                    val unresolved = articleDao.getUnresolvedArticles()

                    if (unresolved.isNotEmpty()) {
                        Timber.d("Unresolved articles: ${unresolved.size}")
                        for (chunk in unresolved.chunked(50)) {
                            try {
                                val response = postgrestClient.sendArticles(chunk)
                                if (response) {
                                    articleDao.updateResolved(
                                        chunk.map { it.itemId },
                                         10,
                                     )
                                     Timber.d("Successfully updated resolved for ${chunk.size} articles")
                                } else {
                                    Timber.w("Failed to send ${chunk.size} articles (HTTP error), will retry in next sync")
                                    break
                                }
                                // Add delay between chunks to avoid overwhelming the server
                                delay(1000)
                            } catch (e: Exception) {
                                Timber.e(e, "Failed to send ${chunk.size} articles")
                                break
                                 // Don't let one failed chunk stop the entire sync
                            }
                        }
                    }

                }
                    repopulateJob.join()
                } catch (e: Exception) {
                    Timber.e(e)
                    hadErrors = true
                }
                setProgress(workDataOf(PROGRESS to 50))
            }

            delay(1000)
            while (syncJob.isActive) {
                if (hadErrors) {
                    return@withContext Result.failure()
                }
                delay(5000)
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
     * A coroutine producer channel that retrieves articles from the Remote API in batches of [ARTICLE_LIMIT].
     *
     * This function retrieves articles from the network data source, sending them in batches to the returned channel.
     * It uses the `since` parameter to retrieve articles modified since the last update time, fetched from the `articleRepository`.
     *
     * @return A `ReceiveChannel<List<ArticleData>>` that emits lists of ArticleData.
     *  * Each list contains a batch of articles (up to [ARTICLE_LIMIT]).
     *  * The channel is closed when there are no more articles to retrieve.
     *
     * @throws [RuntimeException] if an error occurs during article retrieval. This is a temporary placeholder and should be replaced with more specific error handling.
     */
    private fun CoroutineScope.produceArticles() = produce {
//        val since = getSinceFromLocalUseCase()
        val since = articleRepository.getLastUpdatedArticleTime()
        var offset = 0
        val next = true
        while (next) {
            val articleList: MutableList<ArticleData> = networkDataSource(
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
     * @param receiveArticles ReceiveChannel<ArticleData>
     *     a channel that emits a ArticleData with article text retrieved
     *     the channel is closed when there are no more articles to retrieve
     *
     * TODO: handle error
     */
//    context(RemoteRepository)
    private fun CoroutineScope.articleSaver(no: Int, receiveArticles: ReceiveChannel<MutableList<ArticleData>>) =
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
