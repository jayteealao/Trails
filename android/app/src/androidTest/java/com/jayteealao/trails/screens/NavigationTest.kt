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

package com.jayteealao.trails.screens

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.MainActivity
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.testtags.ArticleListTestTags
import com.jayteealao.trails.testtags.MainNavTestTags
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import javax.inject.Inject

/**
 * End-to-end navigation characterization: drives the real [MainActivity] through the full
 * Hilt graph + Navigation 3 stack and asserts the list → detail flow, seeding the list from
 * the in-memory `TestDatabaseModule` database. Kept instrumented (not Robolectric) because
 * forcing the whole `MainActivity` + Hilt + Nav3 stack under Robolectric is the fragile
 * combination the plan flagged; the isolated screen-content assertions live in the JVM
 * suite instead.
 *
 * The app gates the article list behind auth, so the test enters via the production
 * "Skip Login (Browse Local Articles)" affordance (the guest/skip path that calls
 * `onLoginSuccess`) — this is the real, unauthenticated entry into the local library, not a
 * test-only backdoor. Best-effort per the PO: this is a final-gate suite, and the Room+Hilt
 * smoke test remains the per-step golden master.
 */
@HiltAndroidTest
class NavigationTest {

    @get:Rule(order = 0)
    var hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Inject
    lateinit var articleDao: ArticleDao

    private val seededArticle = Article(
        itemId = "nav-article-1",
        title = "Navigation characterization article",
        url = "https://trails.example.com/nav-article-1",
        givenUrl = "https://trails.example.com/nav-article-1",
    )

    @Before
    fun setUp() {
        hiltRule.inject()
        runBlocking { articleDao.upsertArticle(seededArticle) }
    }

    @Test
    fun listToDetail_navigatesThroughRealGraph() {
        // Enter the local library past the auth gate via the guest/skip affordance.
        composeTestRule.onNodeWithText(
            text = "Skip Login",
            substring = true,
        ).performClick()

        // The list pane renders through the real graph once we are past auth.
        composeTestRule.waitUntil(timeoutMillis = 10_000) {
            composeTestRule
                .onAllNodesWithTag(MainNavTestTags.LIST_PANE)
                .fetchSemanticsNodes().isNotEmpty()
        }
        composeTestRule.onNodeWithTag(MainNavTestTags.LIST_PANE).assertIsDisplayed()

        // The seeded article surfaces through paging; open it.
        composeTestRule.waitUntil(timeoutMillis = 10_000) {
            composeTestRule
                .onAllNodesWithTag(ArticleListTestTags.item(seededArticle.itemId))
                .fetchSemanticsNodes().isNotEmpty()
        }
        composeTestRule
            .onNodeWithTag(ArticleListTestTags.item(seededArticle.itemId))
            .performClick()

        // The detail pane appears — navigation resolved end-to-end.
        composeTestRule.waitUntil(timeoutMillis = 10_000) {
            composeTestRule
                .onAllNodesWithTag(MainNavTestTags.DETAIL_PANE)
                .fetchSemanticsNodes().isNotEmpty()
        }
        composeTestRule.onNodeWithTag(MainNavTestTags.DETAIL_PANE).assertIsDisplayed()
    }
}
