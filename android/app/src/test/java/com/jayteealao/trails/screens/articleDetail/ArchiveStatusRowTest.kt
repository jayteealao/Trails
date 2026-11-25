package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The archive status row: its words, its one action and how a screen reader meets it. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArchiveStatusRowTest {

    @get:Rule
    val rule = createComposeRule()

    private var retries = 0

    private fun show(status: String, retry: ArchiveRetryState = ArchiveRetryState.Idle) {
        val row = archiveRowFor(hasText = true, status = status, retry = retry)!!
        rule.setContent {
            TrailsTheme(darkTheme = false) { ArchiveStatusRow(row, onRetry = { retries++ }) }
        }
    }

    @Test
    fun failed_showsTheWordsAndTryAgain_oneCallPerTap() {
        show("failed")

        rule.onNodeWithText("The archive failed. This text is kept.").assertExists()
        rule.onNodeWithText("Try again").assertIsEnabled().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(1, retries)
    }

    @Test
    fun trying_hasNoAction() {
        show("failed", ArchiveRetryState.Sending())

        rule.onNodeWithText("Trying the archive again").assertExists()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun processing_hasNoAction() {
        show("processing")

        rule.onNodeWithText("Still archiving this page").assertExists()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun notSent_saysWhy_andKeepsTryAgain() {
        show("failed", ArchiveRetryState.NotSent(RetryFailure.OFFLINE))

        rule.onNodeWithText("The retry was not sent because you’re offline. This text is kept.").assertExists()
        rule.onNodeWithText("Try again").assertIsEnabled().performClick()
        assertEquals(1, retries)
    }

    @Test
    fun notRetryable_hasNoAction() {
        show("failed", ArchiveRetryState.NotRetryable)

        rule.onNodeWithText("This page can’t be archived again. This text is kept.").assertExists()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    @Test
    fun theWordsAloneAreAPoliteLiveRegion() {
        show("failed")

        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        rule.onNodeWithText("The archive failed. This text is kept.").assert(polite)
        rule.onNodeWithText("Try again").assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
    }
}
