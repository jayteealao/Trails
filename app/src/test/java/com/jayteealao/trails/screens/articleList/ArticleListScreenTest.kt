package com.jayteealao.trails.screens.articleList

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.paging.PagingData
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.any
import io.mockk.every
import io.mockk.firstArg
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ArticleListScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val article = ArticleItem(
        itemId = "id-1",
        title = "Sample Article",
        url = "https://example.com/article",
        snippet = "Snippet"
    )

    @Test
    fun articleListScreen_showsSyncIndicatorWhenSyncing() {
        val viewModel = createViewModel(syncing = true)

        composeRule.setContent {
            TrailsTheme {
                ArticleListScreen(
                    viewModel = viewModel,
                    onSelectArticle = {}
                )
            }
        }

        composeRule.onNodeWithTag("syncIndicator").assertIsDisplayed()
    }

    @Test
    fun articleListScreen_hidesSyncIndicatorWhenNotSyncing() {
        val viewModel = createViewModel(syncing = false)

        composeRule.setContent {
            TrailsTheme {
                ArticleListScreen(
                    viewModel = viewModel,
                    onSelectArticle = {}
                )
            }
        }

        composeRule.onNodeWithTag("syncIndicator").assertDoesNotExist()
    }

    @Test
    fun articleListScreen_callsOnSelectArticleWhenItemTapped() {
        val viewModel = createViewModel(syncing = false)
        var selected: ArticleItem? = null

        composeRule.setContent {
            TrailsTheme {
                ArticleListScreen(
                    viewModel = viewModel,
                    onSelectArticle = { selected = it }
                )
            }
        }

        composeRule.onNodeWithTag("articleList").assertIsDisplayed()
        composeRule.onNodeWithText(article.title).performClick()

        assertEquals(article, selected)
    }

    private fun createViewModel(syncing: Boolean): ArticleListViewModel {
        val viewModel = mockk<ArticleListViewModel>()
        every { viewModel.articles } returns MutableStateFlow(PagingData.from(listOf(article)))
        every { viewModel.databaseSync } returns MutableStateFlow(syncing)
        every { viewModel.selectedArticleSummary } returns MutableStateFlow(PocketSummary(summary = article.snippet ?: ""))
        val selectedFlow = MutableStateFlow(EMPTYARTICLEITEM)
        every { viewModel.selectedArticle } returns selectedFlow
        every { viewModel.selectArticle(any()) } answers {
            selectedFlow.value = firstArg()
            Unit
        }
        return viewModel
    }
}
