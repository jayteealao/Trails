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
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import timber.log.Timber
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

            setForeground(getForegroundInfo())

            var syncJob: Job? = null
            syncJob = launch(Dispatchers.IO) {
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
    private fun CoroutineScope.producePocketArticleFromLocal() = produce<MutableList<PocketArticle>> {
        var offset = 0
        while (true) {
            var articles: MutableList<PocketArticle>? = null
            articles = pocketDao.getPocketsWithoutText(offset).toMutableList()
            if (articles.isEmpty()) {
                Timber.d("No more articles to retrieve")
                break
            }
            offset += articles.size - 1
            send(articles)
            Timber.d("Sent ${articles.size} articles")
        }
        Timber.d("Closing channel")
//        articles = null
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
        receiveArticle: ReceiveChannel<MutableList<PocketArticle>>,
    ) = launch {
        for (articles in receiveArticle) {

            //create an empty list of deferred jobs to retrieve article text
            val deferredList = mutableListOf<Deferred<Unit>>()

            //for each article in the list, retrieve the article text
            articles.forEach { article ->
                deferredList.add(
                    async {
                        if (!isValidArticleForExtraction(article)) {
                            return@async
                        }
                        val result = extractArticleText(article)
                        if (result != null) {
                            pocketDao.insertPocket(result)
                            return@async
                        }
                        return@async
//                        try {
//                            //if the article already has text or is an empty string, skip
//                            if (article.text != null) {
//                                return@async
//                            }
//
//                            //if the article is a pdf, skip
//                            if (article.url?.endsWith(".pdf") == true) {
//                                return@async
//                            }
//
//                            //if the article has a url or givenUrl, retrieve the article text
//                            if(article.url?.isNotBlank() == true || article.givenUrl?.isNotBlank() == true){
////                                Timber.d("URL: ${article.url} - GIVENURL: ${article.givenUrl}")
////                                Timber.d(article.givenUrl)
//                                //convert the url to a HttpUrl object
//                                val url = article.url?.toHttpUrlOrNull() ?: article.givenUrl?.toHttpUrlOrNull()
//
//                                article.text = articleExtractor(url) ?: ""
//                            } else {
//                                article.text = ""
//                            }
//
//                            pocketDao.insertPocket(article)
//                            return@async
//
//                        } catch (e: Exception) {
//                            Timber.d("Failed to insert ${article.itemId} url ${article.url} givenUrl ${article.givenUrl}")
//                            Timber.e(e)
//                        }
                    }
                )
            }
            deferredList.map { it.await() }
            deferredList.clear()
            articles.clear()
        }
    }

    private suspend fun extractArticleText(article: PocketArticle): PocketArticle? {
        val url: HttpUrl? = article.url?.toHttpUrlOrNull() ?: article.givenUrl?.toHttpUrlOrNull()
        if (url == null) {
            article.text = ""
            return article
        }

        return try {
            article.text = articleExtractor(url) ?: ""
            article
        } catch (e: Exception) {
            Timber.e(e, "Failed to extract text for article ${article.itemId} with URL: ${url}")
            null
        }
    }

    private fun isValidArticleForExtraction(article: PocketArticle): Boolean {
        return article.text == null && article.url?.endsWith(".pdf") != true
    }

    internal companion object {
        /**
         * Expedited one time work to sync data on app startup.
         */
        internal fun startUpArticleExtractorWork() = OneTimeWorkRequestBuilder<ArticleExtractorWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
//            .setConstraints(constraints)
            .addTag("ArticleExtractorWorker")
            .build()
    }
}