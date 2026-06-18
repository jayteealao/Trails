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
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.sync.SyncStatusMonitor
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import org.junit.After
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
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultArticleRepositoryTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var syncStatusMonitor: SyncStatusMonitor
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager

    private lateinit var repository: ArticleRepositoryImpl

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            syncStatusMonitor = syncStatusMonitor,
            firestoreSyncManager = firestoreSyncManager,
            ioDispatcher = StandardTestDispatcher(),
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
}
