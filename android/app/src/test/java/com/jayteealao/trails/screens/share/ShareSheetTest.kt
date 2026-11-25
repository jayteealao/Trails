package com.jayteealao.trails.screens.share

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.AccessibilityManager
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The words, the actions and the time of the share sheet. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ShareSheetTest {

    @get:Rule
    val rule = createComposeRule()

    private var state by mutableStateOf<ShareState>(SAVE)
    private val heard = mutableListOf<String>()

    /** The content alone, in a box of [width]. */
    private fun showContent(width: Int = 412, height: Int = 915, fontScale: Float = 1f) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                    Surface {
                        Box(Modifier.size(width.dp, height.dp)) {
                            ShareSheetContent(
                                state = state,
                                onUndo = { heard += "undo" },
                                onRetry = { heard += "retry" },
                                onClose = { heard += "close" },
                            )
                        }
                    }
                }
            }
        }
    }

    /** The whole sheet, with a clock that only the test moves once it is open. */
    private fun showSheet(accessibility: AccessibilityManager? = null) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAccessibilityManager provides accessibility) {
                    ShareSheet(
                        state = state,
                        onUndo = { heard += "undo" },
                        onRetry = { heard += "retry" },
                        onClosed = { heard += "closed" },
                    )
                }
            }
        }
        rule.waitForIdle()
        rule.mainClock.autoAdvance = false
    }

    private fun advance(millis: Long) = rule.mainClock.advanceTimeBy(millis)

    /** Shows [newState]; with the clock held, a write of the test is seen only after it is announced. */
    private fun show(newState: ShareState) {
        rule.runOnUiThread { state = newState }
        Snapshot.sendApplyNotifications()
        advance(100)
    }

    private fun button(label: String) = rule.onNode(hasText(label) and hasClickAction())

    private fun assertButtons(vararg labels: String) {
        rule.onAllNodes(hasClickAction()).assertCountEquals(labels.size)
        labels.forEach { label ->
            val touch = button(label).fetchSemanticsNode().touchBoundsInRoot
            assertTrue("$label: $touch", touch.height >= with(rule.density) { 48.dp.toPx() })
        }
    }

    @Test
    fun eachStateSaysItsWords_andOffersItsActions() {
        showContent()
        data class Row(val state: ShareState, val words: String, val line: String, val buttons: List<String>)
        listOf(
            Row(SAVE.copy(phase = SavePhase.SAVING), "Saving…", SAVE.host, listOf("Close")),
            Row(SAVE, "Saved", SAVE.host, listOf("Undo")),
            Row(SAVE.copy(phase = SavePhase.UNDOING), "Saved", SAVE.host, listOf("Undo")),
            Row(SAVE.copy(phase = SavePhase.ALREADY_SAVED), "Already in your library", SAVE.host, listOf("Close")),
            Row(
                SAVE.copy(phase = SavePhase.NOT_SAVED), "Not saved",
                "This phone could not store the article. Try again.", listOf("Close", "Try again"),
            ),
            Row(
                SAVE.copy(phase = SavePhase.NOT_UNDONE), "Not removed",
                "This phone could not remove the article. Try again.", listOf("Close", "Try again"),
            ),
            Row(
                ShareState.NoLink, "No link to save",
                "Share a page or a link that starts with http.", listOf("Close"),
            ),
        ).forEach { row ->
            state = row.state
            rule.waitForIdle()
            rule.onNodeWithText(row.words).assertIsDisplayed().assert(
                SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
            )
            val title = if (row.state == ShareState.NoLink) "The shared text has no web address" else SAVE.title
            rule.onNodeWithText(title).assertIsDisplayed()
                .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
            rule.onNodeWithText(row.line).assertIsDisplayed()
            assertButtons(*row.buttons.toTypedArray())
        }
    }

    @Test
    fun theButtonsAreHeard_andUndoOnlyOnce() {
        showContent()
        button("Undo").assertIsEnabled().performClick()
        state = SAVE.copy(phase = SavePhase.UNDOING)
        rule.waitForIdle()
        button("Undo").assertIsNotEnabled()
        state = SAVE.copy(phase = SavePhase.NOT_SAVED)
        rule.waitForIdle()
        button("Try again").performClick()
        button("Close").performClick()

        assertEquals(listOf("undo", "retry", "close"), heard)
    }

    @Test
    fun theSheetHasAName_andClosesWhenTheTimeEnds_notBefore() {
        showSheet()
        rule.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Save to Trails")).assertExists()

        advance(8_500)
        assertTrue(heard.isEmpty())
        advance(3_000)
        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun aTitleThatComesLate_doesNotStartTheTimeAgain() {
        showSheet()
        advance(8_000)
        show(SAVE.copy(title = "The title of the page"))
        rule.onNodeWithText("The title of the page").assertIsDisplayed()
        advance(3_000)

        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun anArticleInTheLibrary_closesToo() {
        state = SAVE.copy(phase = SavePhase.ALREADY_SAVED)
        showSheet()
        advance(11_500)

        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun aPersonWhoNeedsMoreTime_getsIt() {
        showSheet(
            object : AccessibilityManager {
                override fun calculateRecommendedTimeoutMillis(
                    originalTimeoutMillis: Long,
                    containsIcons: Boolean,
                    containsText: Boolean,
                    containsControls: Boolean,
                ) = if (containsControls) originalTimeoutMillis * 3 else originalTimeoutMillis
            },
        )
        advance(25_000)
        assertTrue(heard.isEmpty())
        advance(6_500)
        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun undoStopsTheTime_andTheSheetClosesWhenTheArticleIsGone() {
        showSheet()
        advance(5_000)
        show(SAVE.copy(phase = SavePhase.UNDOING))
        advance(30_000)
        assertTrue(heard.isEmpty())

        show(SAVE.copy(phase = SavePhase.UNDONE))
        advance(1_000)
        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun whatIsNotSaved_staysUntilItIsClosed() {
        listOf(
            ShareState.NoLink,
            SAVE.copy(phase = SavePhase.SAVING),
            SAVE.copy(phase = SavePhase.NOT_UNDONE),
            SAVE.copy(phase = SavePhase.NOT_SAVED),
        ).forEachIndexed { index, next ->
            if (index == 0) {
                state = next
                showSheet()
            } else {
                show(next)
            }
            advance(60_000)
            assertTrue("$next", heard.isEmpty())
            rule.onNodeWithText(if (next is ShareState.Save) WORDS.getValue(next.phase) else "No link to save")
                .assertIsDisplayed()
        }

        button("Close").performClick()
        advance(1_000)
        assertEquals(listOf("closed"), heard)
    }

    @Test
    fun aRetryThatWorks_startsTheWholeTime() {
        state = SAVE.copy(phase = SavePhase.NOT_SAVED)
        showSheet()
        advance(30_000)
        show(SAVE)
        advance(9_000)
        assertTrue(heard.isEmpty())
        advance(2_000)
        assertEquals(listOf("closed"), heard)
    }

    // Native graphics, because without them every letter is one pixel wide and no line wraps.
    @Test
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun aLongTitleHasTwoLines_andALongHostIsWhole() {
        state = LONG
        showContent(width = 320)

        val title = rule.onNodeWithText(LONG.title).getBoundsInRoot()
        assertTrue("$title", title.right <= 320.dp && title.bottom - title.top in 50.dp..54.dp)
        val host = rule.onNodeWithText(LONG.host).getBoundsInRoot()
        assertTrue("$host", host.right <= 320.dp && host.bottom - host.top > 30.dp)
    }

    @Test
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun atTheLargestFontOnASmallPhone_theActionsAreReachable() {
        state = LONG.copy(phase = SavePhase.NOT_SAVED)
        showContent(width = 320, height = 320, fontScale = 2f)

        button("Try again").performScrollTo().assertIsDisplayed().performClick()
        button("Close").performScrollTo().assertIsDisplayed().performClick()
        assertEquals(listOf("retry", "close"), heard)
    }

    private companion object {
        val WORDS = mapOf(
            SavePhase.SAVING to "Saving…",
            SavePhase.NOT_UNDONE to "Not removed",
            SavePhase.NOT_SAVED to "Not saved",
        )
        val SAVE = ShareState.Save("A river in winter", "rivers.example.org", SavePhase.SAVED)
        val LONG = ShareState.Save(
            title = "Benachrichtigungseinstellungen and other compound words: how one very long summer " +
                "rebuilt a forty-year-old newsletter",
            host = "reading-room.archive.the-longest-subdomain-in-the-list.example.org",
            phase = SavePhase.ALREADY_SAVED,
        )
    }
}
