package com.jayteealao.trails.screens.articleSearch

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What search says when it finds nothing, fails or runs, and its messages, over a real ViewModel. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleSearchScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { allTags() } returns flowOf(emptyList())
    }
    private val words = SearchBarState()
    private val viewModel by lazy { ArticleSearchViewModel(repository, Dispatchers.Unconfined) }

    private fun show() {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleSearchScreen(
                    searchBarState = words,
                    viewStore = rememberViewStore { viewModel },
                    onSelectArticle = {},
                )
            }
        }
    }

    private fun search(query: String) {
        rule.onNode(hasSetTextAction()).performTextInput(query)
        rule.onNode(hasSetTextAction()).performImeAction()
        rule.waitForIdle()
    }

    private fun assertGone(text: String) =
        rule.onAllNodesWithText(text, substring = true, useUnmergedTree = true).assertCountEquals(0)

    private val tryAgain = hasText("Try again") and hasClickAction()

    @Test
    fun beforeTheFirstSearch_onlyTheFieldShows() {
        show()

        rule.onNodeWithContentDescription("Search").assertIsDisplayed()
        rule.onAllNodesWithContentDescription("Loading articles").assertCountEquals(0)
        assertGone("No articles match")
    }

    @Test
    fun noMatch_namesTheQuery_andClearSearchEmptiesTheFieldAndTheNotice() {
        coEvery { repository.searchLocal("zigurrat") } returns emptyList()
        show()
        search("zigurrat")

        rule.onNodeWithText("No articles match “zigurrat”", useUnmergedTree = true).assertIsDisplayed()
        rule.onNode(hasText("Clear search") and hasClickAction()).performClick()
        rule.waitForIdle()

        assertEquals("", words.searchText)
        assertGone("No articles match")
    }

    @Test
    fun theNoticeNamesTheSearchedWords_notTheWordsBeingTyped() {
        coEvery { repository.searchLocal("zigurrat") } returns emptyList()
        show()
        search("zigurrat")

        rule.onNode(hasSetTextAction()).performTextInput("s of old")
        rule.waitForIdle()

        rule.onNodeWithText("No articles match “zigurrat”", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun aFieldEmptiedByHand_clearsTheSearch() {
        coEvery { repository.searchLocal("river") } returns listOf(ROW)
        show()
        search("river")
        rule.onNodeWithText(ROW.title).assertIsDisplayed()

        rule.onNode(hasSetTextAction()).performTextClearance()
        rule.waitForIdle()

        assertGone(ROW.title)
    }

    @Test
    fun aFailedSearch_offersTryAgain_andRepeatsTheQuery_withNoExceptionText() {
        coEvery { repository.searchLocal("river") } throws IllegalStateException(RAW) andThen listOf(ROW)
        show()
        search("river")

        rule.onNodeWithText("Search did not finish", useUnmergedTree = true).assertIsDisplayed()
        assertGone(RAW)
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()

        rule.onNodeWithText(ROW.title).assertIsDisplayed()
        coVerify(exactly = 2) { repository.searchLocal("river") }
    }

    @Test
    fun aRunningSearch_isTheSkeleton() {
        val answer = CompletableDeferred<List<ArticleItem>>()
        coEvery { repository.searchLocal("river") } coAnswers { answer.await() }
        show()
        search("river")
        rule.onNodeWithContentDescription("Loading articles").assertIsDisplayed()

        answer.complete(listOf(ROW))
        rule.waitForIdle()
        rule.onNodeWithText(ROW.title).assertIsDisplayed()
    }

    @Test
    fun aFailedChange_isOnScreen_andTryAgainRepeatsIt() {
        coEvery { repository.archive("a") } throws IllegalStateException(RAW) andThen Unit
        show()
        viewModel.archiveArticle("a")
        rule.waitForIdle()

        rule.onNodeWithText("That change was not saved on this phone.").assertIsDisplayed()
        assertGone(RAW)
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        coVerify(exactly = 2) { repository.archive("a") }
    }

    @Test
    fun aToast_isOnScreen() {
        show()
        viewModel.regenerateArticleDetails("a")
        rule.waitForIdle()

        rule.onNodeWithText("Regenerate details not available in search", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val RAW = "raw text of the exception"
        val ROW = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a")
    }
}
