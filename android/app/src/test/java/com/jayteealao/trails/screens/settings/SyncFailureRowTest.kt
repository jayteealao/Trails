package com.jayteealao.trails.screens.settings

import android.app.Application
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/**
 * The Settings row for articles skipped after 3 failed sync runs: absent at 0, the count
 * and Retry otherwise, progress and a Retry that reads as "Retrying" and ignores taps
 * while a retry runs; a failed retry's message reaches the person.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class SyncFailureRowTest {

    @get:Rule
    val rule = createComposeRule()

    private var retries = 0

    private fun show(count: Int, isRetrying: Boolean = false) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                SyncFailureRow(count = count, isRetrying = isRetrying, onRetry = { retries++ })
            }
        }
    }

    @Test
    fun zero_rendersNothing() {
        show(0)

        rule.onNodeWithText("failed to sync", substring = true).assertDoesNotExist()
        rule.onNodeWithText("Retry").assertDoesNotExist()
    }

    @Test
    fun two_showsCountSubtitleAndRetry() {
        show(2)

        rule.onNodeWithText("2 articles failed to sync").assertExists()
        rule.onNodeWithText("Skipped after 3 tries. Their latest changes are only on this device.").assertExists()
        rule.onNodeWithText("Retry").assertIsEnabled().assertHeightIsAtLeast(48.dp)

        rule.onNodeWithText("Retry").performClick()
        assertEquals(1, retries)
    }

    @Test
    fun one_isSingular() {
        show(1)

        rule.onNodeWithText("1 article failed to sync").assertExists()
    }

    @Test
    fun retrying_keepsRetryFocusable_readsAsRetrying_andIgnoresTaps() {
        show(2, isRetrying = true)

        rule.onNodeWithText("Retry")
            .assertIsEnabled()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Retrying"))
            .performClick()
        assertEquals(0, retries)
    }

    @Test
    fun count_isAPoliteLiveRegion() {
        show(2)

        rule.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
            useUnmergedTree = true,
        ).assertExists()
    }

    @Test
    fun failedRetryMessage_isShownToThePerson() {
        showSettingsMessage(RuntimeEnvironment.getApplication(), "Retry failed. These articles will be tried again on the next sync.")

        assertEquals(
            "Retry failed. These articles will be tried again on the next sync.",
            ShadowToast.getTextOfLatestToast(),
        )
    }
}
