package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The messages of the article pane, with and without a loaded article. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleDetailMessagesTest {

    @get:Rule
    val rule = createComposeRule()

    private val article = Article(
        itemId = "a", url = "https://example.com/a", givenUrl = "https://example.com/a", text = "# A river in winter",
    )
    private val repository = mockk<ArticleRepository>(relaxed = true)

    private fun show() {
        val preferences = mockk<SharedPreferencesManager>(relaxed = true) {
            every { preferenceChangesFlow() } returns MutableSharedFlow()
        }
        val archives = mockk<ArchiveService>(relaxed = true) {
            every { observeRemoteArchives(any()) } returns emptyFlow()
            every { observeDownloads(any()) } returns flowOf(emptyMap())
            every { observeArticleStatus(any()) } returns flowOf(null)
        }
        val localArchives = mockk<LocalArchiveDao>(relaxed = true) {
            coEvery { getArchivesForArticle(any()) } returns emptyList()
            every { observeArchives(any()) } returns emptyFlow()
        }
        val network = mockk<NetworkMonitor> { every { isOnline } returns flowOf(true) }
        val viewModel = ArticleDetailViewModel(
            articleRepository = repository,
            sharedPreferencesManager = preferences,
            archiveService = archives,
            localArchiveDao = localArchives,
            urlModifier = mockk(relaxed = true),
            networkMonitor = network,
            archiveRetryClient = mockk(relaxed = true),
            ioDispatcher = Dispatchers.Unconfined,
        )
        viewModel.setSelectedTab(READER_TAB_INDEX)
        rule.setContent {
            TrailsTheme(darkTheme = false) { ArticleDetailPane(articleId = "a", viewModel = viewModel) }
        }
        rule.waitForIdle()
    }

    private val tryAgain = hasText("Try again") and hasClickAction()

    private fun assertNoRawText() =
        rule.onAllNodesWithText(RAW, substring = true, useUnmergedTree = true).assertCountEquals(0)

    @Test
    fun anArticleThatDoesNotOpen_saysSo_andTryAgainOpensIt() {
        coEvery { repository.getArticleById("a") } throws IllegalStateException(RAW) andThen article
        show()

        rule.onNodeWithText(OPEN_FAILED).assertIsDisplayed()
        assertNoRawText()
        rule.onNode(tryAgain).performClick()
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText("Reader").fetchSemanticsNodes().isNotEmpty() }

        rule.onAllNodesWithText(OPEN_FAILED).assertCountEquals(0)
    }

    @Test
    fun anOpenFailure_staysUntilItIsAnswered() {
        coEvery { repository.getArticleById("a") } throws IllegalStateException(RAW)
        show()

        rule.mainClock.advanceTimeBy(60_000)
        rule.onNodeWithText(OPEN_FAILED).assertIsDisplayed()
    }

    @Test
    fun aFailedReadMark_isOnScreenAboveTheTabs_andTryAgainRepeatsIt() {
        coEvery { repository.getArticleById("a") } returns article
        coEvery { repository.setReadStatus("a", true) } throws IllegalStateException(RAW) andThen Unit
        show()

        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(MARK_FAILED).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText(MARK_FAILED).assertIsDisplayed()
        assertNoRawText()
        val message = rule.onNodeWithText(MARK_FAILED).getBoundsInRoot()
        val tab = rule.onNode(hasText("Reader") and hasClickAction()).getBoundsInRoot()
        assertTrue(message.bottom <= tab.top)

        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        coVerify(exactly = 2) { repository.setReadStatus("a", true) }
    }

    private companion object {
        const val RAW = "raw text of the exception"
        const val OPEN_FAILED = "The article did not open."
        const val MARK_FAILED = "The article was not marked as read."
        const val WAIT_MILLIS = 5_000L
    }
}
