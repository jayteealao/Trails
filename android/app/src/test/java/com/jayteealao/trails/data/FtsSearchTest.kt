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
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [ArticleRepositoryImpl.searchLocal] hands the DAO the match string built from the typed
 * words (any word matches) and the result limit, and returns the DAO's ranked list as it is.
 * The query behaviour itself is pinned on a real database by Fts5SearchQueryTest.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FtsSearchTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager

    private lateinit var repository: ArticleRepositoryImpl

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            firestoreSyncManager = firestoreSyncManager,
            coroutineScope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `searchLocal sends each word as a quoted OR term with the limit of 100`() = runTest {
        coEvery { articleDao.searchArticlesRanked(any(), any()) } returns emptyList()

        repository.searchLocal("river mill")

        coVerify(exactly = 1) { articleDao.searchArticlesRanked("\"river\" OR \"mill\"", 100) }
        assertEquals(100, SEARCH_RESULT_LIMIT)
    }

    @Test
    fun `searchLocal runs no query for empty or blank input`() = runTest {
        assertTrue(repository.searchLocal("").isEmpty())
        assertTrue(repository.searchLocal("   ").isEmpty())

        coVerify(exactly = 0) { articleDao.searchArticlesRanked(any(), any()) }
    }

    @Test
    fun `searchLocal returns the ranked list unchanged`() = runTest {
        val ranked = listOf(
            ArticleItem(itemId = "b", title = "Best", url = "https://example.com/b"),
            ArticleItem(itemId = "a", title = "Second", url = "https://example.com/a"),
            ArticleItem(itemId = "c", title = "Third", url = "https://example.com/c"),
        )
        coEvery { articleDao.searchArticlesRanked("\"river\"", 100) } returns ranked

        assertEquals(ranked, repository.searchLocal("river"))
    }
}
