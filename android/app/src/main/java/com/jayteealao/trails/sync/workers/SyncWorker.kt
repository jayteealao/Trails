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
import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.datasource.NetworkDataSource
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.services.postgrest.PostgrestClient
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
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import me.saket.unfurl.Unfurler
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

    @Inject
    lateinit var articleDao: ArticleDao
    @Inject
    lateinit var contentMetricsCalculator: ContentMetricsCalculator
    @Inject
    lateinit var archiveService: ArchiveService
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
                    val nonMetricsArticles = articleDao.getNonMetricsArticles()
                    if (nonMetricsArticles.isNotEmpty()) {
                        Timber.d("Processing ${nonMetricsArticles.size} non-metrics articles")

                        val jobs = nonMetricsArticles.map { article ->
                            launch(Dispatchers.IO) {
                                try {
                                    if (article.title.isBlank()) {
                                        val result = unfurler.unfurl(article.url ?: article.givenUrl!!)
                                        val resolvedUrl = (result?.url ?: article.url).toString()
                                        articleDao.updateUnfurledDetails(
                                            itemId = article.itemId,
                                            title = result?.title ?: article.title,
                                            url = resolvedUrl,
                                            image = if (result?.thumbnail == null) article.image else result.thumbnail.toString(),
                                            hasImage = result?.thumbnail != null,
                                            excerpt = if (article.excerpt.isNullOrBlank()) result?.description ?: "" else article.excerpt,
                                            normalizedUrl = normalizeUrl(resolvedUrl),
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

                    // ── Phase 7: Background archive sync ─────────────────────
                    // TODO: Re-enable after verifying ArticleDetailViewModel.loadArchives() in isolation
                    // syncArchivesInBackground()

                    // ── Phase 6: Metadata backfill ───────────────────────────
                    // backfillMetadata()

                    // ── Phase 6: Content metrics for newly text-populated ────
                    // computeContentMetrics()

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

    // ── Phase 7: Download archives and populate text for articles ─────────

    private suspend fun syncArchivesInBackground() {
        val batchSize = 20
        var offset = 0

        while (currentCoroutineContext().isActive) {
            val itemIds = articleDao.getArticlesNeedingText(batchSize, offset)
            if (itemIds.isEmpty()) break

            Timber.d("Archive sync: processing ${itemIds.size} articles (offset=$offset)")

            for (itemId in itemIds) {
                if (!currentCoroutineContext().isActive) break
                try {
                    // Fetch remote archive status from Firestore
                    val doc = com.google.firebase.firestore.FirebaseFirestore.getInstance()
                        .collection("articles")
                        .document(itemId)
                        .get()
                        .await()

                    if (!doc.exists()) {
                        delay(100)
                        continue
                    }

                    @Suppress("UNCHECKED_CAST")
                    val archivesMap = doc.get("archives") as? Map<String, Map<String, Any>>
                        ?: emptyMap()

                    val remoteArchives = archivesMap.mapNotNull { (key, value) ->
                        val status = value["status"] as? String ?: return@mapNotNull null
                        val gcsPath = value["gcs_path"] as? String
                        key to com.jayteealao.trails.data.archive.ArchiveStatus(status, gcsPath)
                    }.toMap()

                    if (remoteArchives.isNotEmpty()) {
                        // Download archive files locally
                        archiveService.syncArchives(itemId, remoteArchives)

                        // Populate article.text from readability or markdown
                        populateTextFromArchive(itemId)
                    }

                    // Apply screenshot as image fallback if article has no image
                    archiveService.applyScreenshotAsImage(itemId)

                    delay(100) // Rate-limit Firestore reads
                } catch (e: Exception) {
                    Timber.e(e, "Archive sync failed for $itemId")
                }
            }

            offset += batchSize
        }
    }

    private suspend fun populateTextFromArchive(itemId: String) {
        val article = articleDao.getArticleById(itemId) ?: return
        if (!article.text.isNullOrBlank()) return

        // Prefer readability over markdown
        val type = listOf(ArchiveType.READABILITY, ArchiveType.MARKDOWN)
            .firstOrNull { archiveService.getLocalArchiveFile(itemId, it) != null }
            ?: return

        val text = archiveService.readArchiveText(itemId, type) ?: return
        articleRepository.updateArticleText(itemId, text, type.archiveKey)
        Timber.d("Populated text for $itemId from ${type.archiveKey}")
    }

    // ── Phase 6: Metadata backfill from Warg ─────────────────────────────

    private suspend fun backfillMetadata() {
        val batchSize = 50
        var offset = 0

        while (currentCoroutineContext().isActive) {
            val articles = articleDao.getArticlesWithMissingMetadata(batchSize, offset)
            if (articles.isEmpty()) break

            Timber.d("Metadata backfill: processing ${articles.size} articles (offset=$offset)")

            for (article in articles) {
                if (!currentCoroutineContext().isActive) break
                try {
                    val metadata = archiveService.fetchWargMetadata(article.itemId)
                    if (metadata != null) {
                        articleRepository.backfillMetadata(article.itemId, metadata)
                    }
                    delay(100) // Rate-limit Firestore reads
                } catch (e: Exception) {
                    Timber.e(e, "Metadata backfill failed for ${article.itemId}")
                }
            }

            offset += batchSize
        }
    }

    // ── Phase 6: Compute content metrics for newly text-populated articles ──

    private suspend fun computeContentMetrics() {
        val articles = articleDao.getNonMetricsArticles()
        if (articles.isEmpty()) return

        // Only process articles that have text (resolved = 2 means text was just added)
        val articlesWithText = articles.filter { it.resolved == 2 && !it.text.isNullOrBlank() }
        if (articlesWithText.isEmpty()) return

        Timber.d("Computing metrics for ${articlesWithText.size} articles")

        for (article in articlesWithText) {
            if (!currentCoroutineContext().isActive) break
            try {
                val metrics = contentMetricsCalculator.calculateMetrics(article.text!!)
                articleDao.updateArticleMetrics(
                    itemId = article.itemId,
                    timeToRead = metrics.readingTimeMinutes,
                    listenDurationEstimate = metrics.listeningTimeMinutes,
                    wordCount = metrics.wordCount,
                )
                Timber.d("Updated metrics for ${article.itemId}: ${metrics.wordCount} words, ${metrics.readingTimeMinutes}min read")
            } catch (e: Exception) {
                Timber.e(e, "Failed to compute metrics for ${article.itemId}")
            }
        }
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
     *     a channel that emits ArticleData with article text retrieved
     *     the channel is closed when there are no more articles to retrieve
     *
     * TODO: handle error
     */
//    context(PocketRepository)
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
