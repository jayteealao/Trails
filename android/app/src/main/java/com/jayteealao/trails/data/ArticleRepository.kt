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
import com.jayteealao.trails.common.di.ApplicationScope
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import com.jayteealao.trails.data.archive.WargMetadata
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.search.FtsMatchQuery
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.sync.workers.FirestoreRestoreWorker
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/** Most rows one local search returns. */
const val SEARCH_RESULT_LIMIT = 100

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

    suspend fun getArticleById(itemId: String): Article?

    val isSyncing: Flow<Boolean>

    suspend fun getTags(itemId: String): List<String>

    fun allTags(): Flow<List<String>>

//    suspend fun search(query: String): List<ArticleItem>
    suspend fun searchLocal(query: String): List<ArticleItem>

    fun syncToFirestore()

    fun restoreFromFirestore()

    suspend fun updateArticleText(itemId: String, text: String, source: String)

    suspend fun backfillMetadata(itemId: String, metadata: WargMetadata)

    /**
     * Back up a single article to Firestore and write its existence marker now.
     * Satisfies the read-gate for a freshly-saved article before anyone opens the
     * detail screen. On success, stamps [backedUpAt] in Room so the reconciliation
     * sweep can skip already-backed-up articles.
     *
     * Failures are surfaced as [Result.failure] — callers fall back to the periodic
     * background sync without crashing.
     */
    suspend fun backupArticleNow(itemId: String): Result<Unit>

    suspend fun saveNewArticle(article: Article): String
    suspend fun upsertArticle(article: Article)
    suspend fun updateUnfurledDetails(
        itemId: String, title: String, url: String,
        image: String?, hasImage: Boolean, excerpt: String, normalizedUrl: String
    )
}

interface Syncable {
    fun synchronize()
}

/**
 * Default implementation of [ArticleRepository]
 * @param articleDao ArticleDao
 *    data access object
 * @param coroutineScope CoroutineScope
 *    application-lifetime supervised scope for background work
 */
class ArticleRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val articleDao: ArticleDao,
    private val firestoreSyncManager: FirestoreSyncManager,
    private val firestoreBackupService: FirestoreBackupService,
    @ApplicationScope private val coroutineScope: CoroutineScope,
) : ArticleRepository {

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
    override suspend fun getArticleById(itemId: String): Article? {
         return articleDao.getArticleById(itemId)
    }

    override suspend fun getTags(itemId: String): List<String> = articleDao.getArticleTags(itemId)

    override fun allTags(): Flow<List<String>> = articleDao.getAllTags()

    /**
     * Saves ArticleData to local database
     * @param articleData ArticleData
     *     data to be saved
     */
    override suspend fun add(articleData: List<ArticleData>) {
        // Transform articles (normalized URL, undelete, bump timeUpdated) before the
        // transactional insert so the DAO method stays free of business logic.
        val articlesToAdd = articleData.map { datum ->
            datum.article.copy(
                normalizedUrl = datum.article.computeNormalizedUrl(),
                deletedAt = null,
                archivedAt = null,
                timeUpdated = System.currentTimeMillis() // Update timestamp for sync
            )
        }

        // Single @Transaction DAO call: articles + all associated data are written
        // atomically, so a crash mid-insert cannot leave articles without their tags/images.
        articleDao.upsertArticlesWithAssociatedData(articlesToAdd, articleData)

        // Trigger immediate sync for new articles
        coroutineScope.launch {
            try {
                firestoreSyncManager.syncLocalChanges()
            } catch (e: Exception) {
                Timber.e(e, "Failed to sync newly added articles")
            }
        }
    }

    override suspend fun setFavorite(itemId: String, isFavorite: Boolean) {
        val timestamp = if (isFavorite) System.currentTimeMillis() else 0L
        articleDao.updateFavorite(itemId, isFavorite, timestamp)
    }

    override suspend fun setReadStatus(itemId: String, isRead: Boolean) {
        val now = System.currentTimeMillis()
        val readTimestamp = if (isRead) now else null
        articleDao.updateReadStatus(itemId, isRead, readTimestamp, now)
    }

    override suspend fun addTag(itemId: String, tag: String) {
        if (tag.isBlank()) return
        val timestamp = System.currentTimeMillis()
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
        // Update timeUpdated to trigger sync
        articleDao.updateTimeUpdated(itemId, timestamp)
    }

    override suspend fun removeTag(itemId: String, tag: String) {
        if (tag.isBlank()) return
        articleDao.deleteArticleTag(itemId, tag)
        // Update timeUpdated to trigger sync
        articleDao.updateTimeUpdated(itemId, System.currentTimeMillis())
    }

    override suspend fun archive(itemId: String) {
        articleDao.updateArchived(itemId, System.currentTimeMillis())
    }

    override suspend fun delete(itemId: String) {
        // Soft-delete locally; the deletion is an ordinary change that the sync
        // pushes through the one serializer (as deletedAt).
        articleDao.updateDeleted(itemId, System.currentTimeMillis())

        coroutineScope.launch {
            try {
                firestoreSyncManager.syncLocalChanges()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to sync deletion of $itemId")
            }
        }
    }

    override suspend fun updateExcerpt(itemId: String, excerpt: String) {
        articleDao.updateExcerpt(itemId, excerpt)
    }

    /**
     * Searches the local library: every typed word or quoted phrase matches (any of them),
     * best first by bm25, live articles only, at most [SEARCH_RESULT_LIMIT] rows.
     * Blank input runs no query.
     */
    override suspend fun searchLocal(query: String): List<ArticleItem> =
        FtsMatchQuery.build(query)?.let { articleDao.searchArticlesRanked(it, SEARCH_RESULT_LIMIT) }
            ?: emptyList()

    /**
     * Show the Firestore sync state
     */
    override val isSyncing: Flow<Boolean>
        get() = firestoreSyncManager.isSyncing

    /**
     * Synchronize articles - uses bidirectional Firestore sync
     * This replaces the old Pocket API sync that is no longer available
     */
    override fun synchronize() {
        coroutineScope.launch {
            firestoreSyncManager.syncLocalChanges()
        }
    }

    /**
     * Backup articles to Firestore for the current user
     * Uses WorkManager for background sync
     */
    override fun syncToFirestore() {
        WorkManager.getInstance(context)
            .beginUniqueWork(
                "FirestoreBackupWork",
                ExistingWorkPolicy.KEEP,
                FirestoreSyncWorker.startUpSyncWork()
            )
            .enqueue()
    }

    /**
     * Restore articles from Firestore for the current user
     * Useful when user signs in on a new device
     */
    override fun restoreFromFirestore() {
        WorkManager.getInstance(context)
            .beginUniqueWork(
                "FirestoreRestoreWork",
                ExistingWorkPolicy.KEEP,
                FirestoreRestoreWorker.startUpRestoreWork()
            )
            .enqueue()
    }

    override suspend fun updateArticleText(itemId: String, text: String, source: String) {
        articleDao.updateTextWithSource(itemId, text, source)
    }

    override suspend fun backfillMetadata(itemId: String, metadata: WargMetadata) {
        val article = articleDao.getArticleById(itemId) ?: return

        val newTitle = if (article.title.isBlank() && !metadata.title.isNullOrBlank()) {
            metadata.title
        } else {
            article.title
        }
        val newExcerpt = if (article.excerpt.isNullOrBlank() && !metadata.excerpt.isNullOrBlank()) {
            metadata.excerpt
        } else {
            article.excerpt
        }
        val newWordCount = if (article.wordCount == 0 && metadata.wordCount != null) {
            metadata.wordCount
        } else {
            article.wordCount
        }

        if (newTitle != article.title || newExcerpt != article.excerpt || newWordCount != article.wordCount) {
            articleDao.upsertArticle(
                article.copy(
                    title = newTitle,
                    excerpt = newExcerpt,
                    wordCount = newWordCount,
                )
            )
        }
    }

    /**
     * Backs up [itemId] to Firestore (article doc + existence marker) immediately,
     * then stamps [backedUpAt] in Room on success so the reconciliation sweep can
     * skip it.
     *
     * Fires synchronously on the caller's coroutine — the ViewModel calls this
     * inline in `saveUrl` after the unfurl, before handing off to the periodic
     * background sync. A failure here is not fatal: the periodic sync will retry.
     */
    override suspend fun backupArticleNow(itemId: String): Result<Unit> {
        // Stamp with a time taken before the read, so an edit made during the upload
        // still counts as unsynced.
        val readAt = System.currentTimeMillis()
        val article = articleDao.getArticleById(itemId)
            ?: return Result.failure(NoSuchElementException("Article $itemId not found locally"))
        val result = firestoreBackupService.backupArticle(article)
        if (result.isSuccess) {
            // A successful push also clears any failed-push count on the row.
            articleDao.markBackedUp(listOf(itemId), readAt)
        }
        return result
    }

    override suspend fun saveNewArticle(article: Article): String =
        articleDao.upsertNewArticle(article)

    override suspend fun upsertArticle(article: Article) =
        articleDao.upsertArticle(article)

    override suspend fun updateUnfurledDetails(
        itemId: String, title: String, url: String,
        image: String?, hasImage: Boolean, excerpt: String, normalizedUrl: String
    ) = articleDao.updateUnfurledDetails(itemId, title, url, image, hasImage, excerpt, normalizedUrl)
}

