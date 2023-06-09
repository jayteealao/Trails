package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.network.ArticleExtractor
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.channels.produce
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.net.URL
import javax.inject.Inject


@HiltWorker
class ArticleExtractorWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var articleExtractor: ArticleExtractor

    @Inject
    lateinit var pocketDao: PocketDao

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        var syncJob: Job? = null
        setForeground(getForegroundInfo())
        syncJob = launch {
            val receiveArticle = producePocketArticleFromLocal()
            repeat(5) {
                retrieveTextForArticles(receiveArticle)
            }
        }
        delay(1000)
        while (syncJob.isActive) {
            delay(1000)
        }
        Result.success()

    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        return appContext.syncForegroundInfo()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun CoroutineScope.producePocketArticleFromLocal() = produce<List<PocketArticle>> {
        var offset = 0
        while (true) {
            val articles = pocketDao.getPocketsWithoutText(offset)
            if (articles.isEmpty()) {
                Timber.d("No more articles to retrieve")
                break
            }
            offset += articles.size
            send(articles)
            Timber.d("Sent ${articles.size} articles")
        }
        close()
    }

    /**
     * A coroutine consumer channel that receives articles from a producer channel
     * and retrieves the article text from the article url using a third party library
     * @param receiveArticle ReceiveChannel<Array<PocketData>>
     *     a channel that emits an array of PocketData
     *     each array contains 100 articles
     *     the channel is closed when there are no more articles to retrieve
     *     or when an error occurs
     * @return ReceiveChannel<PocketData>
     *     a channel that emits a PocketData with article text retrieved
     *     the channel is closed when there are no more articles to retrieve
     *
     * TODO: handle error
     *
     */
    private fun CoroutineScope.retrieveTextForArticles(
        receiveArticle: ReceiveChannel<List<PocketArticle>>,
    ) = launch {
        for (articles in receiveArticle) {
            val deferredList = mutableListOf<Deferred<Unit>>()
            articles.forEach { article ->
                deferredList.add(
                    async {
                        try {
                            val url = URL(article.url)
                            if (article.url?.endsWith(".pdf") == true) {
                                return@async
                            }
                            article.text = articleExtractor.extractEssence(url)
                                ?: articleExtractor.extractReadability(url)
                                        ?: articleExtractor.extractCrux(url)
                                        ?: ""
                            pocketDao.insertPocket(article)
                        } catch (e: Exception) {
                            Timber.d("Failed to insert ${article.itemId} url ${article.url} givenUrl ${article.givenUrl}")
                            Timber.e(e)
                        }
                    }
                )
            }
            deferredList.map { it.await() }
        }
    }

    internal companion object {
        /**
         * Expedited one time work to sync data on app startup.
         */
        internal fun startUpArticleExtractorWork() = OneTimeWorkRequestBuilder<ArticleExtractorWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
    }
}