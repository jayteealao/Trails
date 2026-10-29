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

package com.jayteealao.trails.data

import android.content.Context
import androidx.paging.PagingSource
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for [ArticleRepositoryImpl] (the production binding behind the
 * [ArticleRepository] interface).
 *
 * Revived as part of the regression-net slice (E1). The original test referenced
 * a deleted `DefaultArticleRepository`/`FakePocketDao` pair; it now pins the one
 * behaviour the net needs from the repository: `pockets()` is a thin delegation
 * to `ArticleDao.getArticlesWithTags()`. Deeper repository behaviour is covered
 * by the slices that change it.
 *
 * Extended with two tests for the repository cleanup (B3):
 * - [delete marks the row deleted and triggers a sync, and writes nothing to Firestore directly]
 * - [add performs single bulk article upsert] — single upsertArticles() call, not per-item upsertArticle()
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultArticleRepositoryTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var repository: ArticleRepositoryImpl

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            firestoreSyncManager = firestoreSyncManager,
            coroutineScope = CoroutineScope(SupervisorJob() + testDispatcher),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `pockets delegates to articleDao getArticlesWithTags`() {
        val pagingSource = mockk<PagingSource<Int, ArticleItem>>()
        every { articleDao.getArticlesWithTags() } returns pagingSource

        val result = repository.pockets()

        assertSame(pagingSource, result)
        verify(exactly = 1) { articleDao.getArticlesWithTags() }
    }

    /**
     * The list screen's sync indicator reads [ArticleRepositoryImpl.isSyncing]; it must
     * follow the Firestore sync state, not a monitor of background work that never runs.
     */
    @Test
    fun `isSyncing follows FirestoreSyncManager`() = runTest(testDispatcher) {
        val syncing = MutableStateFlow(false)
        every { firestoreSyncManager.isSyncing } returns syncing

        val emitted = mutableListOf<Boolean>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            repository.isSyncing.toList(emitted)
        }

        syncing.value = true
        syncing.value = false

        assertEquals(listOf(false, true, false), emitted)
    }

    /**
     * A delete is an ordinary local change: the row is marked deleted and the normal
     * sync pushes it (as `deletedAt`). The repository never writes Firestore itself —
     * it has no Firestore handle to write with.
     */
    @Test
    fun `delete marks the row deleted and triggers a sync, and writes nothing to Firestore directly`() = runTest(testDispatcher) {
        coEvery { articleDao.updateDeleted(any(), any()) } returns Unit

        repository.delete("item1")
        advanceUntilIdle()

        coVerify(exactly = 1) { articleDao.updateDeleted("item1", any()) }
        coVerify(exactly = 1) { firestoreSyncManager.syncLocalChanges() }
    }

    /**
     * add() must delegate to the single transactional DAO method
     * [ArticleDao.upsertArticlesWithAssociatedData] exactly once, guaranteeing that
     * articles and their associated data are written atomically.  It must never call
     * the non-transactional [ArticleDao.upsertArticles] or per-item
     * [ArticleDao.upsertArticle] directly.
     */
    @Test
    fun `add delegates to transactional upsertArticlesWithAssociatedData`() = runTest(testDispatcher) {
        val articles = (1..3).map { i ->
            ArticleData(
                article = Article(itemId = "id$i", articleId = "aid$i"),
                images = emptyList(),
                videos = emptyList(),
                tags = emptyList(),
                authors = emptyList(),
                domainMetadata = null,
            )
        }
        coEvery { articleDao.upsertArticlesWithAssociatedData(any(), any()) } returns Unit
        coEvery { firestoreSyncManager.syncLocalChanges() } returns Unit

        repository.add(articles)
        advanceUntilIdle()

        coVerify(exactly = 1) { articleDao.upsertArticlesWithAssociatedData(any(), any()) }
        coVerify(exactly = 0) { articleDao.upsertArticles(any()) }
        coVerify(exactly = 0) { articleDao.upsertArticle(any()) }
    }
}
