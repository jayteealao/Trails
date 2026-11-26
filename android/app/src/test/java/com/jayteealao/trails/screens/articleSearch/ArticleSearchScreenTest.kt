package com.jayteealao.trails.screens.articleSearch

import android.app.Application
import android.content.Intent
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
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
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
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
    private val viewModel by lazy { ArticleSearchViewModel(repository, { mockk() }, Dispatchers.Unconfined) }

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
    fun theSkeletonAndTheResults_areSaidByTalkBack() {
        val answer = CompletableDeferred<List<ArticleItem>>()
        coEvery { repository.searchLocal("river") } coAnswers { answer.await() }
        show()
        search("river")
        rule.onNode(hasContentDescription("Loading articles") and isLiveRegion()).assertExists()

        answer.complete(listOf(ROW))
        rule.waitForIdle()
        rule.onNode(hasContentDescription("1 article found") and isLiveRegion()).assertExists()
    }

    private fun isLiveRegion() = SemanticsMatcher("is a polite live region") {
        it.config.getOrNull(SemanticsProperties.LiveRegion) == LiveRegionMode.Polite
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
        viewModel.archiveArticle("a")
        rule.waitForIdle()

        rule.onNodeWithText("Article archived").assertIsDisplayed()
    }

    private fun showResult() {
        coEvery { repository.searchLocal("river") } returns listOf(ROW)
        show()
        search("river")
    }

    /** Long-presses the result and chooses [label] in the sheet. */
    private fun choose(label: String) {
        rule.onNode(hasText(ROW.title) and hasClickAction()).performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNode(hasText(label) and hasClickAction()).performClick()
        rule.waitForIdle()
    }

    @Test
    fun deleteInTheSheet_takesTheRowAway_andUndoBringsItBack() {
        showResult()
        choose("Delete")
        assertGone(ROW.title)
        rule.onNodeWithText("Article deleted").assertIsDisplayed()

        rule.onNode(hasText("Undo") and hasClickAction()).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(ROW.title).assertIsDisplayed()
        coVerify(exactly = 1) { repository.restore("a") }
    }

    @Test
    fun shareCopyAndOpen_doWhatTheySay() {
        showResult()
        val application = RuntimeEnvironment.getApplication()

        choose("Share")
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(application).nextStartedActivity.action)

        choose("Open in browser")
        assertEquals(ROW.url, shadowOf(application).nextStartedActivity.dataString)

        choose("Copy link")
        rule.onNodeWithText("Article URL copied to clipboard").assertIsDisplayed()
    }

    @Test
    fun aRegenerateThatCannotReadThePage_saysSoInTheSheet() {
        coEvery { repository.getArticleById("a") } returns Article(itemId = "a", url = "not a link")
        showResult()
        choose("Regenerate details")
        val words = "The article details were not updated."
        rule.waitUntil(5_000L) { rule.onAllNodesWithText(words).fetchSemanticsNodes().isNotEmpty() }

        rule.onNodeWithText(words).assertIsDisplayed()
        coVerify(exactly = 0) { repository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    }

    private companion object {
        const val RAW = "raw text of the exception"
        val ROW = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a")
    }
}
