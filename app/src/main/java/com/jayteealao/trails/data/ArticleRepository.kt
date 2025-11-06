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
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.sync.SyncStatusMonitor
import com.jayteealao.trails.sync.initializers.SyncWorkName
import com.jayteealao.trails.sync.workers.SyncWorker
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

    fun favoritePockets(): PagingSource<Int, ArticleItem>

    fun archivedPockets(): PagingSource<Int, ArticleItem>

    fun pocketsByTag(tag: String): PagingSource<Int, ArticleItem>

    suspend fun add(articleData: List<ArticleData>)

    suspend fun setFavorite(itemId: String, isFavorite: Boolean)

    suspend fun setReadStatus(itemId: String, isRead: Boolean)

    suspend fun addTag(itemId: String, tag: String)

    suspend fun removeTag(itemId: String, tag: String)

    suspend fun archive(itemId: String)

    suspend fun delete(itemId: String)

    suspend fun updateExcerpt(itemId: String, excerpt: String)

    override fun synchronize()

    fun getArticleById(itemId: String): Article?

    fun getLastUpdatedArticleTime(): Long

    val isSyncing: Flow<Boolean>

    suspend fun getTags(itemId: String): List<String>

    fun allTags(): Flow<List<String>>

//    suspend fun search(query: String): List<ArticleItem>
    suspend fun searchLocal(query: String): List<ArticleItem>

    suspend fun searchHybrid(query: String): List<ArticleItem>
}

interface Syncable {
    fun synchronize()
}

/**
 * Default implementation of [ArticleRepository]
 * @param articleDao ArticleDao
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
    private val articleDao: ArticleDao,
    private val syncStatusMonitor: SyncStatusMonitor,
//    private val modalClient: ModalClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ArticleRepository {

    private val coroutineScope = CoroutineScope(ioDispatcher)

//    override fun pockets(): PagingSource<Int, ArticleItem> = pocketDao.getArticles()
    override fun pockets(): PagingSource<Int, ArticleItem> = articleDao.getArticlesWithTags()

    override fun favoritePockets(): PagingSource<Int, ArticleItem> = articleDao.getFavoriteArticlesWithTags()

    override fun archivedPockets(): PagingSource<Int, ArticleItem> = articleDao.getArchivedArticlesWithTags()

    override fun pocketsByTag(tag: String): PagingSource<Int, ArticleItem> = articleDao.getArticlesWithTag(tag)

    /**
     * Get article by id
     * @param itemId String
     * @return Article
     *     an Article
     */
    override fun getArticleById(itemId: String): Article? {
         return articleDao.getArticleById(itemId)
    }

    override fun getLastUpdatedArticleTime() = articleDao.getLastUpdatedArticleTime()

    override suspend fun getTags(itemId: String): List<String> = articleDao.getArticleTags(itemId)

    override fun allTags(): Flow<List<String>> = articleDao.getAllTags()

    /**
     * Saves ArticleData to local database
     * @param articleData ArticleData
     *     data to be saved
     */
    override suspend fun add(articleData: List<ArticleData>) {
        articleData.forEach { datum ->
            articleDao.upsertArticle(datum.article)
            articleDao.insertArticleImages(datum.images)
            datum.videos.let { articleDao.insertArticleVideos(it) }
            articleDao.insertArticleTags(datum.tags)
            articleDao.insertArticleAuthors(datum.authors)
            datum.domainMetadata?.let { articleDao.insertDomainMetadata(it) }
        }
    }

    override suspend fun setFavorite(itemId: String, isFavorite: Boolean) {
        val timestamp = if (isFavorite) System.currentTimeMillis() else 0L
        articleDao.updateFavorite(itemId, isFavorite, timestamp)
    }

    override suspend fun setReadStatus(itemId: String, isRead: Boolean) {
        val timestamp = if (isRead) System.currentTimeMillis() else null
        articleDao.updateReadStatus(itemId, isRead, timestamp)
    }

    override suspend fun addTag(itemId: String, tag: String) {
        if (tag.isBlank()) return
        articleDao.insertArticleTags(
            listOf(
                ArticleTags(
                    itemId = itemId,
                    tag = tag,
                    sortId = null,
                    type = null,
                )
            )
        )
    }

    override suspend fun removeTag(itemId: String, tag: String) {
        if (tag.isBlank()) return
        articleDao.deleteArticleTag(itemId, tag)
    }

    override suspend fun archive(itemId: String) {
        articleDao.updateArchived(itemId, System.currentTimeMillis())
    }

    override suspend fun delete(itemId: String) {
        articleDao.updateDeleted(itemId, System.currentTimeMillis())
    }

    override suspend fun updateExcerpt(itemId: String, excerpt: String) {
        articleDao.updateExcerpt(itemId, excerpt)
    }

    override suspend fun searchHybrid(query: String): List<ArticleItem> {
        val searchResult: LinkedHashSet<ArticleItem> = linkedSetOf()
        val deferred = coroutineScope.async {
//            val data = modalClient.searchHybrid(query).getOrElse(emptyList())
//            val sortedData = data.sortedBy { Language.it.distance }.map { Language.it.id }
//            val searchHybridResult = pocketDao.getArticlesByIds(sortedData)
//                .sortedBy { sortedData.indexOf(it.itemId) }
//            searchResult.addAll(searchHybridResult)
            Timber.d("searchHybrid: $searchResult")
        }
        deferred.await()
        return searchResult.toList()
    }

    /**
     * search for articles in local database uses fts4
     * @param query String
     * @return List<ArticleItem>
     *     a list of ArticleItem that matches the query
     */
    override suspend fun searchLocal(query: String): List<ArticleItem> {

        return searchWithScore(query)
    }

    /**
     * search for articles in local database uses fts4
     * @param query String
     * @return List<ArticleItem>
     *     a list of ArticleItem that matches the query
     */
    private suspend fun searchWithScore(query: String): List<ArticleItem> {
        if (query.isEmpty()) {
            return emptyList()
        }
        val sanitizedQuery = sanitizeSearchQuery("*$query*")
        Timber.d("sanitized query $sanitizedQuery")
        return articleDao.searchArticlesWithMatchInfo(query).let { results ->
            results
                .sortedByDescending {
                    calculateScore(it.matchInfo)
                }
                .map { result ->
                    result.article
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

