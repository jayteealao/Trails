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

package com.jayteealao.trails.screens.articleList

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.testfixtures.ArticleTestFixtures
import com.jayteealao.trails.screens.articleList.testfixtures.rememberFakeLazyPagingItems
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.testtags.ArticleListTestTags
import io.yumemi.tartlet.ViewStore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * JVM (Robolectric) characterization of [ArticleListScreenContent] in its **card** layout
 * (`useCardLayout = true` → the `ArticleItemCardStyle` branch). The sibling
 * [ArticleListScreenKtTest] covers the default single-column branch; this test exercises
 * the other rendering path so both survive the migration.
 *
 * Retargeted from the original broken copy, which rendered a non-existent
 * `PocketScreenContent` inside an empty `setContent {}` and asserted on unrendered text
 * (it would have failed if run). It now renders the real composable with the shared fakes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "w400dp-h800dp")
class PocketScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun cardLayout_rendersSeededArticle() {
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { ArticleListState() },
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    useCardLayout = true,
                )
            }
        }

        composeTestRule.onNodeWithText(ArticleTestFixtures.firstTitle).assertIsDisplayed()
    }

    @Test
    fun cardLayout_itemClickPropagates() {
        var clicked: ArticleItem? = null
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { ArticleListState() },
                    onSelectArticle = { clicked = it },
                    onOpenTagManagement = {},
                    useCardLayout = true,
                )
            }
        }

        composeTestRule
            .onNodeWithTag(ArticleListTestTags.item(ArticleTestFixtures.firstItemId))
            .performClick()
        composeTestRule.waitForIdle()

        assertEquals(ArticleTestFixtures.firstItemId, clicked?.itemId)
    }
}
