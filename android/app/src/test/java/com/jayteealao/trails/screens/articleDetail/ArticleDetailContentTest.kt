package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Where the archive status row sits in the article screen, and what a tap on Try again leaves. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleDetailContentTest {

    @get:Rule
    val rule = createComposeRule()

    private var retry by mutableStateOf<ArchiveRetryState>(ArchiveRetryState.Idle)
    private val tryAgain = hasText("Try again") and hasClickAction()

    private fun show(status: String, text: String? = TEXT) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleDetailContent(
                    state = ArticleDetailState(
                        selectedTabIndex = READER_TAB_INDEX,
                        articleStatus = status,
                        readerBody = readerBodyFor(
                            ReaderSignals(text != null, loaded = true, online = true, articleStatus = status, retry = retry),
                        ),
                        archiveRow = archiveRowFor(text != null, status, retry),
                    ),
                    article = Article(
                        itemId = "a1", url = "https://example.com", givenUrl = "https://example.com", text = text,
                    ),
                    onTabSelected = {},
                    onRetry = { retry = retry.onTap(status) },
                )
            }
        }
        if (text != null) {
            // The Markdown is parsed off the main thread.
            rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(TEXT).fetchSemanticsNodes().isNotEmpty() }
        }
    }

    @Test
    fun failed_theRowIsBetweenTheTextAndTheTabs_andTheTextIsShown() {
        show("failed")

        rule.onNodeWithText(TEXT).assertIsDisplayed()
        rule.onNodeWithText(FAILED_WORDS).assertIsDisplayed()
        val text = rule.onNodeWithText(TEXT).getUnclippedBoundsInRoot()
        val row = rule.onNodeWithText(FAILED_WORDS).getUnclippedBoundsInRoot()
        val tab = rule.onNodeWithText("Reader").getUnclippedBoundsInRoot()
        assertTrue("the text ends above the row", text.bottom <= row.top)
        assertTrue("the row ends above the tabs", row.bottom <= tab.top)
    }

    @Test
    fun tryAgain_becomesTheTryingRow_withNoAction() {
        show("failed")

        rule.onNode(tryAgain).performClick()

        rule.onNodeWithText("Trying the archive again").assertIsDisplayed()
        rule.onNode(tryAgain).assertDoesNotExist()
        rule.onNodeWithText(TEXT).assertIsDisplayed()
    }

    @Test
    fun complete_hasNoRow() {
        show("complete")

        rule.onNodeWithText("archiv", substring = true, ignoreCase = true).assertDoesNotExist()
        rule.onNodeWithText("Reader").assertIsDisplayed()
    }

    @Test
    fun failedWithNoText_theNoticeOffersTryAgain_andThereIsNoRow() {
        show("failed", text = null)

        rule.onNodeWithText(FAILED_WORDS).assertDoesNotExist()
        rule.onNode(tryAgain).assertIsDisplayed().performClick()

        rule.onNodeWithText("The text is on its way").assertExists()
        rule.onNode(tryAgain).assertDoesNotExist()
    }

    private companion object {
        const val TEXT = "The survey began with a question."
        const val FAILED_WORDS = "The archive failed. This text is kept."
        const val WAIT_MILLIS = 10_000L
    }
}
