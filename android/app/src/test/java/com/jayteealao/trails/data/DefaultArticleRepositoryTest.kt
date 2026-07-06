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
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.android.gms.tasks.Tasks
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.sync.SyncStatusMonitor
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
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
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
 *
 * Extended with two tests for the repository cleanup (B3):
 * - [delete uses injected FirebaseAuth and FirebaseFirestore] — no raw getInstance() call
 * - [add performs single bulk article upsert] — single upsertArticles() call, not per-item upsertArticle()
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DefaultArticleRepositoryTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var syncStatusMonitor: SyncStatusMonitor
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager
    @MockK private lateinit var firestoreBackupService: FirestoreBackupService
    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var firebaseAuth: FirebaseAuth

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var repository: ArticleRepositoryImpl

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            syncStatusMonitor = syncStatusMonitor,
            firestoreSyncManager = firestoreSyncManager,
            firestoreBackupService = firestoreBackupService,
            coroutineScope = CoroutineScope(SupervisorJob() + testDispatcher),
            firestore = firestore,
            firebaseAuth = firebaseAuth,
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
     * B3 — delete() must use the injected [FirebaseAuth] and [FirebaseFirestore] handles,
     * not raw [FirebaseAuth.getInstance()] / [FirebaseFirestore.getInstance()].
     *
     * Because no mockkStatic(FirebaseAuth::class) is registered, any call to the raw
     * getInstance() would throw an unmocked-static exception, serving as a negative
     * assertion that the static call path is gone.
     */
    @Test
    fun `delete uses injected FirebaseAuth and FirebaseFirestore`() = runTest(testDispatcher) {
        val mockUser = mockk<FirebaseUser> { every { uid } returns "uid1" }
        every { firebaseAuth.currentUser } returns mockUser

        val mockCollection = mockk<CollectionReference>(relaxed = true)
        val mockDocument = mockk<DocumentReference>(relaxed = true)
        every { firestore.collection("users") } returns mockCollection
        every { mockCollection.document("uid1") } returns mockDocument
        every { mockDocument.collection("articles") } returns mockCollection
        every { mockCollection.document("item1") } returns mockDocument
        every { mockDocument.set(any(), any<SetOptions>()) } returns Tasks.forResult(null)
        coEvery { articleDao.updateDeleted(any(), any()) } returns Unit

        repository.delete("item1")
        advanceUntilIdle()

        verify { firebaseAuth.currentUser }
        verify { firestore.collection("users") }
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
