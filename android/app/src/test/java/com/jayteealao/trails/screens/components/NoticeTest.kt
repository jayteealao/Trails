package com.jayteealao.trails.screens.components

import android.app.Application
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the shared notice shows, says to a screen reader and offers. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w320dp-h568dp", application = Application::class)
class NoticeTest {

    @get:Rule
    val rule = createComposeRule()

    private var tries = 0
    private var opens = 0

    private fun show(title: String = TITLE, text: String? = TEXT) = rule.setContent {
        TrailsTheme(darkTheme = false) {
            Notice(
                icon = ReaderNoticeIcons.Failed,
                title = title,
                text = text,
                isError = true,
                actions = listOf(
                    NoticeAction("Try again", NoticeActionStyle.FILLED) { tries++ },
                    NoticeAction("Open Settings", NoticeActionStyle.TEXT) { opens++ },
                ),
            )
        }
    }

    private val isLiveRegion =
        SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)

    @Test
    fun theWordsAreShown_andTheTitleIsAHeading() {
        show()

        rule.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        rule.onNodeWithText(TEXT, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun theWordsAreOnePoliteLiveRegion_withNoIconDescription() {
        show()

        rule.onNode(isLiveRegion)
            .assert(hasText(TITLE) and hasText(TEXT))
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
    }

    @Test
    fun theActionsAreOutsideTheLiveRegion_48dpHigh_andEachTapCallsOnce() {
        show()

        listOf("Try again", "Open Settings").forEach { label ->
            val button = hasText(label) and hasClickAction()
            rule.onAllNodes(button).assertCountEquals(1)
            rule.onAllNodes(button and hasAnyAncestor(isLiveRegion)).assertCountEquals(0)
            val touch = rule.onNode(button).fetchSemanticsNode().touchBoundsInRoot
            assertTrue(touch.height >= with(rule.density) { 48.dp.toPx() })
            rule.onNode(button).performClick()
        }

        assertEquals(1, tries)
        assertEquals(1, opens)
    }

    @Test
    fun aNoticeWithNoText_isTheTitleAndItsActions() {
        show(text = null)

        rule.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
        rule.onAllNodesWithText(TEXT, useUnmergedTree = true).assertCountEquals(0)
        rule.onNode(hasText("Try again") and hasClickAction()).assertIsDisplayed()
    }

    @Test
    @Config(fontScale = 2f)
    fun longWords_wrapInsideTheScreen_andTheActionsScrollIntoView() {
        val address = "aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org"
        show(title = "Benachrichtigungseinstellungen did not finish loading", text = address)

        val bounds = rule.onNodeWithText(address, useUnmergedTree = true).getBoundsInRoot()
        assertTrue(bounds.left >= 16.dp)
        assertTrue(bounds.right <= 304.dp)
        rule.onNode(hasText("Open Settings") and hasClickAction()).performScrollTo().assertIsDisplayed()
    }

    private companion object {
        const val TITLE = "Your library did not load"
        const val TEXT = "You’re offline and this phone has no saved articles yet. Connect, then try again."
    }
}
