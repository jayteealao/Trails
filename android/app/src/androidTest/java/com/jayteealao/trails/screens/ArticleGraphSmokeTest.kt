/*
 * Copyright (C) 2026 The Android Open Source Project
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

package com.jayteealao.trails.screens

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject

/**
 * Golden-master characterization of the runtime Hilt graph + Room round-trip.
 *
 * This is the load-bearing gate the AGP 9 migration is measured against. The ~150 JVM
 * unit tests mock every DAO/Firebase/network boundary, so they exercise none of the
 * Room `_Impl` or Hilt factory code that Kotlin 2.4 / KSP / Hilt 2.60 will regenerate.
 * This test closes that gap by building the real graph and reading a value back off it:
 *
 *  1. The real Hilt `SingletonComponent` builds and injects [AppDatabase] / [ArticleDao].
 *  2. [ArticleRepository] injects — it is bound by the production `DataModule` and is NOT
 *     replaced by any test module, so resolving it proves a broad transitive slice of the
 *     graph's factories (Firestore, Auth, `@ApplicationScope`, WorkManager, …) resolve.
 *  3. An `upsertArticle` → `getArticleById` round-trip returns the inserted row, proving
 *     the generated Room DAO `_Impl` actually reads and writes.
 *
 * The in-memory database comes from `testdi/TestDatabaseModule` (`@TestInstallIn`
 * replaces `DatabaseModule`), so there is no on-disk state to clean up. Each test uses a
 * unique primary key because the singleton in-memory DB is shared across the class.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ArticleGraphSmokeTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var database: AppDatabase

    @Inject
    lateinit var articleDao: ArticleDao

    /**
     * A production graph consumer that is deliberately left in place by the test DI:
     * injecting it proves the real factory chain resolves, not just the swapped DB.
     */
    @Inject
    lateinit var articleRepository: ArticleRepository

    @Before
    fun setUp() {
        hiltRule.inject()
    }

    @Test
    fun hiltGraph_buildsAndInjectsRealComponents() {
        // Injection completing without throwing already exercises the generated Hilt
        // factories; assert the references are live so the test cannot pass vacuously.
        assertNotNull("AppDatabase should be injected from the real Hilt graph", database)
        assertNotNull("ArticleDao should be injected from the real Hilt graph", articleDao)
        assertNotNull(
            "ArticleRepository (production DataModule binding) should resolve its factories",
            articleRepository,
        )
    }

    @Test
    fun roomRoundTrip_returnsInsertedRow() = runTest {
        val expected = Article(
            itemId = "smoke-roundtrip-1",
            title = "Golden master round-trip",
            url = "https://trails.example.com/smoke-roundtrip",
            wordCount = 42,
        )

        articleDao.upsertArticle(expected)
        val actual = articleDao.getArticleById(expected.itemId)

        assertNotNull("Round-trip read should return the row just inserted", actual)
        assertEquals(expected.itemId, actual!!.itemId)
        assertEquals(expected.title, actual.title)
        assertEquals(expected.url, actual.url)
        assertEquals(expected.wordCount, actual.wordCount)
    }
}
