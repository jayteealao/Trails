/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

@file:OptIn(ExperimentalCoroutinesApi::class)

package com.jayteealao.trails.data

import android.content.Context
import androidx.paging.PagingSource
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleExtractor
import com.jayteealao.trails.network.PocketData
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import com.jayteealao.trails.sync.SyncStatusMonitor
import com.jayteealao.trails.sync.initializers.SyncWorkName
import com.jayteealao.trails.sync.workers.SyncWorker
import com.skydoves.sandwich.getOrElse
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import timber.log.Timber
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.inject.Inject

interface ArticleRepository: Syncable {
    fun pockets(): PagingSource<Int, ArticleItem>

    suspend fun add(pocketData: List<PocketData>)

    override fun synchronize()

    fun getArticleById(itemId: String): PocketArticle?

    fun getLastUpdatedArticleTime(): Long

    val isSyncing: Flow<Boolean>

    suspend fun getTags(itemId: String): List<String>

//    suspend fun search(query: String): List<ArticleItem>
    suspend fun searchLocal(query: String): List<ArticleItem>

    suspend fun searchHybrid(query: String): List<ArticleItem>
}

interface Syncable {
    fun synchronize()
}

/**
 * Default implementation of [ArticleRepository]
 * @param pocketDao PocketDao
 *    data access object
 * @param networkDataSource NetworkDataSource
 *    data source for network requests
 *    @see NetworkDataSource
 * @param articleExtractor ArticleExtractor
 *    extracts article from url
 *    @see ArticleExtractor
 * @param getSinceFromLocalUseCase GetSinceFromLocalUseCase
 *    use case for getting since from local database
 *    @see GetSinceFromLocalUseCase
 * @param syncStatusMonitor SyncStatusMonitor
 *    monitor for sync status
 *    @see SyncStatusMonitor
 * @param ioDispatcher CoroutineDispatcher
 *    dispatcher for io operations
 *    @see CoroutineDispatcher
 */
class ArticleRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val pocketDao: PocketDao,
    private val articleExtractor: ArticleExtractor,
    private val syncStatusMonitor: SyncStatusMonitor,
    private val modalClient: ModalClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ArticleRepository {

    private val coroutineScope = CoroutineScope(ioDispatcher)

//    override fun pockets(): PagingSource<Int, ArticleItem> = pocketDao.getArticles()
    override fun pockets(): PagingSource<Int, ArticleItem> = pocketDao.getArticlesWithTags()

    /**
     * Get article by id
     * @param itemId String
     * @return PocketArticle
     *     a PocketArticle
     */
    override fun getArticleById(itemId: String): PocketArticle? {
         return pocketDao.getArticleById(itemId)
    }

    override fun getLastUpdatedArticleTime() = pocketDao.getLastUpdatedArticleTime()

    override suspend fun getTags(itemId: String): List<String> = pocketDao.getPocketTags(itemId)

    /**
     * Saves PocketData to local database
     * @param pocketData PocketData
     *     data to be saved
     */
    override suspend fun add(pocketData: List<PocketData>) {
        pocketData.forEach { pocketDatum ->
            pocketDao.insertPocket(pocketDatum.pocketArticle)
            pocketDao.insertPocketImages(pocketDatum.pocketImages)
            pocketDatum.pocketVideos.let { pocketDao.insertPocketVideos(it) }
            pocketDao.insertPocketTags(pocketDatum.pocketTags)
            pocketDao.insertPocketAuthors(pocketDatum.pocketAuthors)
            pocketDatum.domainMetadata?.let { pocketDao.insertDomainMetadata(it) }
        }
    }

    override suspend fun searchHybrid(query: String): List<ArticleItem> {
        val searchResult: LinkedHashSet<ArticleItem> = linkedSetOf()
        val deferred = coroutineScope.async {
            val data = modalClient.searchHybrid(query).getOrElse(emptyList())
            val sortedData = data.sortedBy { it.distance }.map { it.id }
            val searchHybridResult = pocketDao.getArticlesByIds(sortedData)
                .sortedBy { sortedData.indexOf(it.itemId) }
            searchResult.addAll(searchHybridResult)
            Timber.d("searchHybrid: $searchResult")
        }
        deferred.await()
        return searchResult.toList()
    }

    /**
     * search for articles in local database uses fts4
     * @param query String
     * @return List<PocketArticle>
     *     a list of PocketArticle that matches the query
     */
    override suspend fun searchLocal(query: String): List<ArticleItem> {

        return searchWithScore(query)
    }

    /**
     * search for articles in local database uses fts4
     * @param query String
     * @return List<PocketArticle>
     *     a list of PocketArticle that matches the query
     */
    private suspend fun searchWithScore(query: String): List<ArticleItem> {
        if (query.isEmpty()) {
            return emptyList()
        }
        val sanitizedQuery = sanitizeSearchQuery("*$query*")
        Timber.d("sanitized query $sanitizedQuery")
        return pocketDao.searchPocketsWithMatchInfo(query).let { results ->
            results
                .sortedByDescending {
                    calculateScore(it.matchInfo)
                }
                .map { result ->
                    result.pocket
                }
        }
    }

    /**
     * Sanitize search query to prevent malformed match expression error from fts4
     * @param query String
     * @return String
     */
    private fun sanitizeSearchQuery(query: String?): String {
        if (query == null) {
            return "";
        }
        val queryWithEscapedQuotes = query.replace(Regex.fromLiteral("\""), "\"\"")
        return "*\"$queryWithEscapedQuotes\"*"
    }

    /**
     * Calculate score from match info blob
     * @param matchInfoBlob ByteArray
     * @return Int
     */
    private fun calculateScore(matchInfoBlob: ByteArray): Int {
        val byteBuffer = ByteBuffer.wrap(matchInfoBlob)
        byteBuffer.order(ByteOrder.LITTLE_ENDIAN)
        val intBuffer = byteBuffer.asIntBuffer()
        intBuffer.position(2)
        var score: Int = 0
        while (intBuffer.hasRemaining()) {
            val p = intBuffer.get()
            val c = intBuffer.get()
            val x = intBuffer.get()
            score += p

        }
        return score
    }

    /**
     * Show sync status of synchronizing articles from Pocket API to local database
     */
    override val isSyncing: Flow<Boolean>
        get() = syncStatusMonitor.isSyncing

    /**
     * Synchronize articles from Pocket API to local database
     * @param accessToken Pocket API access token
     * @return Job
     *
     * TODO: Refactor this function
     *
     * note: returns a job object in order to allow preventing the syncworker from suceeding
     * until the coroutine is finished
     */
    override fun synchronize() {
        WorkManager.getInstance(context)
            .beginUniqueWork(SyncWorkName, ExistingWorkPolicy.KEEP, SyncWorker.startUpSyncWork())
//            .then(ArticleExtractorWorker.startUpArticleExtractorWork())
//            .then(SemanticModalWorker.startUpSemanticModalWork())
            .enqueue()
    }
}

