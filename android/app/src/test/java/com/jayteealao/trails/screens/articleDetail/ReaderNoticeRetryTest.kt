package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Try again on the failed Reader notice. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ReaderNoticeRetryTest {

    @get:Rule
    val rule = createComposeRule()

    private var retries = 0
    private val tryAgain = hasText("Try again") and hasClickAction()

    private fun show(body: ReaderBody, onRetry: (() -> Unit)? = { retries++ }) {
        rule.setContent {
            TrailsTheme(darkTheme = false) { ReaderBodyView(body = body, text = "", onRetry = onRetry) }
        }
    }

    @Test
    fun failed_offersTryAgain_oneCallPerTap() {
        show(ReaderBody.Notice(ReaderNoticeKind.FAILED))

        rule.onNode(hasText("The archive failed")).assertExists()
        val button = rule.onNode(tryAgain).assertIsEnabled()
        // The area that takes a touch, which can be taller than the drawn button.
        val touchHeight = with(rule.density) { button.fetchSemanticsNode().touchBoundsInRoot.height.toDp() }
        assertTrue("touch height $touchHeight", touchHeight >= 48.dp)
        button.performClick()
        assertEquals(1, retries)
    }

    @Test
    fun theButtonIsOutsideTheLiveRegion() {
        show(ReaderBody.Notice(ReaderNoticeKind.FAILED))

        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        rule.onNode(polite).assertExists()
        rule.onNode(tryAgain and hasAnyAncestor(polite), useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun notSent_saysWhy_andKeepsTryAgain() {
        show(ReaderBody.Notice(ReaderNoticeKind.FAILED, ArchiveRetryState.NotSent(RetryFailure.OFFLINE)))

        rule.onNodeWithText(
            "The retry was not sent because you’re offline. Try again when you’re back online.",
        ).assertExists()
        rule.onNode(tryAgain).performClick()
        assertEquals(1, retries)
    }

    @Test
    fun notRetryable_hasNoButton() {
        show(ReaderBody.Notice(ReaderNoticeKind.FAILED, ArchiveRetryState.NotRetryable))

        rule.onNodeWithText("This page can’t be archived again. Read it on the Web tab.").assertExists()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun aRunningRetry_showsTheWaitingNotice_withNoButton() {
        var retry by mutableStateOf<ArchiveRetryState>(ArchiveRetryState.Idle)
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ReaderBodyView(
                    body = readerBodyFor(
                        ReaderSignals(hasText = false, loaded = true, online = true, articleStatus = "failed", retry = retry),
                    ),
                    text = "",
                    onRetry = { retry = retry.onTap("failed") },
                )
            }
        }

        rule.onNode(tryAgain).performClick()

        rule.onNodeWithText("The text is on its way").assertExists()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun withNoRetryGiven_thereIsNoButton() {
        show(ReaderBody.Notice(ReaderNoticeKind.FAILED), onRetry = null)

        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun theOtherNotices_haveNoButton() {
        var kind by mutableStateOf(ReaderNoticeKind.WAITING)
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ReaderBodyView(body = ReaderBody.Notice(kind), text = "", onRetry = { retries++ })
            }
        }
        for (other in ReaderNoticeKind.entries - ReaderNoticeKind.FAILED) {
            rule.runOnIdle { kind = other }
            rule.onNodeWithText(other.title).assertExists()
            rule.onNode(hasClickAction()).assertDoesNotExist()
        }
    }
}
