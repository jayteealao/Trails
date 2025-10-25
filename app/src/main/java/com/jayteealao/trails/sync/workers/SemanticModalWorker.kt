package com.jayteealao.trails.sync.workers

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkerParameters
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.services.semanticSearch.modal.ModalArticle
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import com.jayteealao.trails.sync.initializers.syncForegroundInfo
import com.skydoves.sandwich.message
import com.skydoves.sandwich.onError
import com.skydoves.sandwich.onException
import com.skydoves.sandwich.onFailure
import com.skydoves.sandwich.suspendOnSuccess
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

@HiltWorker
class SemanticModalWorker @AssistedInject constructor(
    @Assisted private val appContext: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    @Inject
    lateinit var pocketDao: PocketDao

    @Inject
    lateinit var modalClient: ModalClient

//    @Inject
//    lateinit var supabaseService: SupabaseService

    /**
     * Retrieves foreground information from the application context.
     *
     * @return Foreground information retrieved by synchronously calling [appContext.syncForegroundInfo].
     */
    override suspend fun getForegroundInfo() = appContext.syncForegroundInfo()

    /**
     * Executes the background work of synchronizing Pocket articles with Weaviate.
     *
     * This function retrieves Pocket articles from the local database, processes them in batches,
     * and adds them to the Weaviate database using semantic actions. The work is performed
     * in the background using coroutines and Dispatchers.IO for I/O operations.
     *
     * The worker is set to run in the foreground to ensure its execution even when the app
     * is not actively in use.
     *
     * @return Result.success() indicating successful execution.
     */
    override suspend fun doWork() = withContext(Dispatchers.IO) {
        // Set the worker to run in the foreground
        setForeground(getForegroundInfo())
        
        launch {
//            producePocketArticleFromLocal { offset ->
//                pocketDao.getPocketsWithModalFalse(offset)
//            }.let { receiveArticle ->
                //creates 10 channels to receive articles from the local database
//                repeat(10) {
                    //Adds the articles to the weaviate database
//                    batchSemanticActions(receiveArticle)
//                }
//            }
        }
        Result.success()
    }

    /**
     * Processes batches of articles received from the [receiveArticle] channel.
     * For each batch, it performs the following actions concurrently:
     * 1. Saves the original articles to Supabase.
     * 2. Saves transformed [ModalArticle] objects to Weaviate.
     * 3. Sends the [ModalArticle] objects to Modal for summary generation.
     *
     * This function utilizes coroutines to execute these actions in parallel within an IO dispatcher.
     *
     * @param receiveArticle A [ReceiveChannel] providing batches of [PocketArticle] objects.
     * @return A [Job] representing the launched coroutine.
     */
    private fun CoroutineScope.batchSemanticActions(
        receiveArticle: ReceiveChannel<List<PocketArticle>>
    ) = launch(Dispatchers.IO) {
        for (articles in receiveArticle) {
            val modalArticles = articles.map {
                ModalArticle(
                    it.itemId,
                    it.text ?: ""
                )
            }
            val deferred = listOf(
                async { saveArticlesToSupabase(articles) },
                async { saveToWeaviateDB(modalArticles) },
                async { sendToModalForSummaries(modalArticles) }
            )
            deferred.forEach { it.await() }
        }
    }

    /**
     * Saves a list of articles to Weaviate database and stores the mapping between Pocket IDs and Modal IDs in the local database.
     *
     * This function performs the following operations:
     * 1. Sends the articles to the Modal API for adding to Weaviate.
     * 2. On successful response, inserts the mapping of Pocket IDs to Modal IDs into the `ModalArticleTable` in the local database.
     * 3. Logs any errors encountered during the process.
     *
     * @param articles The list of [ModalArticle] objects to be saved.
     * @return A [Job] representing the coroutine that handles the saving process.
     */
    private fun CoroutineScope.saveToWeaviateDB(
        articles: List<ModalArticle>
    )= launch(Dispatchers.IO) {

        val response = modalClient.addArticles(articles)

        response.suspendOnSuccess {
//            Timber.d(data.data.toString())
            launch(Dispatchers.IO) {
//                pocketDao.insertModalId(
//                    data.data
//                        .entries.map {
//                            ModalArticleTable(
//                                pocketId = it.value,
//                                modalId = it.key
//                            )
//                        }.filterNot { it.modalId == "error" || it.pocketId == "error" }
//                )
            }
            data.data.entries.filter { it.key == "error" }.distinctBy { it.value }
                .also { if (it.isNotEmpty()) Timber.e("Errors: $it") }
        }
            .onError { Timber.e(this.message()) }
            .onFailure { Timber.e(this.message()) }
            .onException { Timber.e(this.message()) }
    }

    /**
     * Saves a list of articles to the Supabase database.
     *
     * This function retrieves articles from the local database (as implied by the `PocketArticle` type)
     * and sends them to the Supabase database using the `supabaseService`.
     * The operation is performed asynchronously within an IO coroutine.
     *
     * @param articles The list of `PocketArticle` objects to be saved to Supabase.
     */
    private fun CoroutineScope.saveArticlesToSupabase(
        articles: List<PocketArticle>
    ) = launch(Dispatchers.IO) {
//        val response = supabaseService.addArticles(articles)
    }

    /**
     * Sends a list of articles to the Modal endpoint for summarization.
     *
     * This function launches a coroutine on the IO dispatcher to perform the following:
     * 1. Sends the articles to the `modalClient` for summarization.
     * 2. On successful summarization:
     *    * Inserts the received summaries into the `pocketDao` on the IO dispatcher.
     *    * Filters out and logs any errors encountered during summarization.
     * 3. Logs any errors (onError, onFailure, onException) that occur during the summarization process.
     *
     * @param articles The list of [ModalArticle] objects to be summarized.
     * @return A [Job] representing the launched coroutine.
     */
    private fun CoroutineScope.sendToModalForSummaries(
        articles: List<ModalArticle>
    ) = launch(Dispatchers.IO) {
        modalClient.summarize(articles).suspendOnSuccess {
            launch(Dispatchers.IO) {
//                pocketDao.insertPocketSummaries(
//                    data.map { summary ->
//                        PocketSummary(
//                            id = summary.id,
//                            summary = summary.summary
//                        )
//                    }.filterNot { it.id == "error" }
//                )
            }
            data.filter { it.id == "error" }.distinctBy { it.summary }
                .also { if (it.isNotEmpty()) Timber.e("Errors: $it") }
        }
            .onError { Timber.e(this.message()) }
            .onFailure { Timber.e(this.message()) }
            .onException { Timber.e(this.message()) }
    }

    internal companion object {

        internal fun startUpSemanticModalWork() = OneTimeWorkRequestBuilder<SemanticModalWorker>()
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
//            .setConstraints(constraints)
            .addTag("SemanticModalWorker")
            .build()
    }
}