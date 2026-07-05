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
import com.jayteealao.trails.data.local.database.ArticleWithMatchInfo
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.sync.SyncStatusMonitor
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for the FTS search sanitization fix in [ArticleRepositoryImpl.searchLocal].
 *
 * Pins the post-fix behaviour: the DAO receives the **sanitized** query (not the raw input)
 * for every input category. The sanitization wraps the input in a phrase-prefix-suffix
 * FTS4 pattern: `*"*<escaped-input>*"*`.
 *
 * Each test calls [ArticleRepositoryImpl.searchLocal] and asserts via
 * [coVerify] that [ArticleDao.searchArticlesWithMatchInfo] was called with the
 * expected sanitized string — not the raw input.
 *
 * Pre-fix: these tests would all fail because the raw query reached the DAO.
 * Post-fix: all 7 cases pass.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FtsSearchTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var syncStatusMonitor: SyncStatusMonitor
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager
    @MockK private lateinit var firestoreBackupService: FirestoreBackupService

    private lateinit var repository: ArticleRepositoryImpl

    /** Reusable empty-results stub for the DAO — most tests don't care about results. */
    private val emptyResults: List<ArticleWithMatchInfo> = emptyList()

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            syncStatusMonitor = syncStatusMonitor,
            firestoreSyncManager = firestoreSyncManager,
            firestoreBackupService = firestoreBackupService,
            ioDispatcher = StandardTestDispatcher(),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    /**
     * TC-1: plain word — baseline
     * Input "hello" → sanitized to `*"*hello*"*`
     */
    @Test
    fun `searchLocal passes sanitized query to DAO for plain word`() = runTest {
        val sanitized = """*"*hello*"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        repository.searchLocal("hello")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
    }

    /**
     * TC-2: unbalanced/embedded quotes escaped
     * Input `say "hi"` → the intermediate `*say "hi"*` has `"` replaced with `""`,
     * then wrapped → `*"*say ""hi""*"*`
     */
    @Test
    fun `searchLocal escapes embedded double-quotes`() = runTest {
        val sanitized = """*"*say ""hi""*"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        repository.searchLocal("""say "hi"""")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
    }

    /**
     * TC-3: lone `*` stays literal inside phrase quotes
     * Input `*` → intermediate `***` → no `"` → wrapped → `*"***"*`
     */
    @Test
    fun `searchLocal treats lone asterisk as literal in phrase quotes`() = runTest {
        val sanitized = """*"***"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        repository.searchLocal("*")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
    }

    /**
     * TC-4: FTS operators neutralised in phrase
     * Input `AND OR NEAR` → intermediate `*AND OR NEAR*` → wrapped → `*"*AND OR NEAR*"*`
     * Operators lose their special meaning inside phrase quotes.
     */
    @Test
    fun `searchLocal neutralises FTS operators inside phrase quotes`() = runTest {
        val sanitized = """*"*AND OR NEAR*"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        repository.searchLocal("AND OR NEAR")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
    }

    /**
     * TC-5: empty query — early return guard
     * [ArticleRepositoryImpl.searchWithScore] returns emptyList() immediately;
     * the DAO must never be called.
     */
    @Test
    fun `searchLocal returns empty list and never calls DAO for empty query`() = runTest {
        val result = repository.searchLocal("")

        assertTrue(result.isEmpty())
        coVerify(exactly = 0) { articleDao.searchArticlesWithMatchInfo(any()) }
    }

    /**
     * TC-6: whitespace-only query — non-crashing path
     * The whitespace string is non-empty so it passes the early-return guard;
     * the DAO receives a sanitized expression and must not crash.
     */
    @Test
    fun `searchLocal passes whitespace query sanitized to DAO without crashing`() = runTest {
        val sanitized = """*"*   *"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        val result = repository.searchLocal("   ")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
        assertEquals(emptyList<Any>(), result)
    }

    /**
     * TC-7: non-ASCII passes through unchanged
     * Input `café résumé` → intermediate `*café résumé*` → no `"` → wrapped →
     * `*"*café résumé*"*`
     */
    @Test
    fun `searchLocal passes non-ASCII query through sanitization unchanged`() = runTest {
        val sanitized = """*"*café résumé*"*"""
        coEvery { articleDao.searchArticlesWithMatchInfo(sanitized) } returns emptyResults

        repository.searchLocal("café résumé")

        coVerify(exactly = 1) { articleDao.searchArticlesWithMatchInfo(sanitized) }
    }
}
