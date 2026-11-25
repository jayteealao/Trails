package com.jayteealao.trails.screens.tagManagement

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the tag sheet says when it does not open or a change is not saved. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class TagManagementScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val article = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a", tagsString = "")
    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { allTags() } returns flowOf(listOf("rivers"))
    }
    private val dao = mockk<ArticleDao>()

    private fun show() {
        val viewModel = TagManagementViewModel(repository, dao, mockk(relaxed = true), Dispatchers.Unconfined)
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                TagManagementScreen(articleId = "a", tagManagementViewModel = viewModel)
            }
        }
        rule.waitForIdle()
    }

    private val tryAgain = hasText("Try again") and hasClickAction()

    private fun assertNoRawText() =
        rule.onAllNodesWithText(RAW, substring = true, useUnmergedTree = true).assertCountEquals(0)

    @Test
    fun aFailedOpen_offersTryAgain_andOpensTheTags() {
        coEvery { dao.getArticlesByIds(listOf("a")) } throws IllegalStateException(RAW) andThen listOf(article)
        show()

        rule.onNodeWithText("The tags did not open", useUnmergedTree = true).assertIsDisplayed()
        assertNoRawText()
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()

        rule.onNodeWithText("Manage tags").assertIsDisplayed()
    }

    @Test
    fun aMissingArticle_isNotAnEndlessSpinner() {
        coEvery { dao.getArticlesByIds(listOf("a")) } returns emptyList()
        show()

        rule.onNodeWithText("The tags did not open", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun aFailedChange_showsItsMessage_andTryAgainRepeatsIt() {
        coEvery { dao.getArticlesByIds(listOf("a")) } returns listOf(article)
        coEvery { repository.addTag("a", "rivers") } throws IllegalStateException(RAW) andThen Unit
        show()

        rule.onNode(hasText("rivers") and hasClickAction()).performClick()
        rule.waitForIdle()

        rule.onNodeWithText("That change was not saved on this phone.").assertIsDisplayed()
        assertNoRawText()
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        coVerify(exactly = 2) { repository.addTag("a", "rivers") }
    }

    private companion object {
        const val RAW = "raw text of the exception"
    }
}
