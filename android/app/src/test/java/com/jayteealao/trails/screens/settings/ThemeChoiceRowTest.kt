package com.jayteealao.trails.screens.settings

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The theme setting: one chosen option with a check mark and a hint, three radio buttons of at
 * least 48 dp, and, when a label does not fit its segment, options that stack with whole words.
 */
@RunWith(RobolectricTestRunner::class)
// Native graphics, so text is measured with its real width.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ThemeChoiceRowTest {

    @get:Rule
    val rule = createComposeRule()

    private val chosen = mutableListOf<ThemeChoice>()

    private fun show(choice: ThemeChoice, width: Dp = 380.dp, fontScale: Float = 1f) {
        rule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                TrailsTheme(darkTheme = false) {
                    Box(Modifier.width(width)) { ThemeChoiceRow(choice, onChoose = { chosen += it }) }
                }
            }
        }
    }

    /** Only [selected] is chosen, it alone has the check mark, and [hint] says what it does. */
    private fun assertChosen(selected: String, hint: String) {
        LABELS.forEach { label ->
            val option = rule.onNodeWithText(label)
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
                .assertHeightIsAtLeast(48.dp)
            if (label == selected) option.assertIsSelected() else option.assertIsNotSelected()
        }
        rule.onNodeWithText(hint).assertExists()
        rule.onAllNodesWithTag(THEME_CHOICE_CHECK_TAG, useUnmergedTree = true).assertCountEquals(1)
        rule.onNode(
            hasTestTag(THEME_CHOICE_CHECK_TAG) and hasAnyAncestor(isSelected()),
            useUnmergedTree = true,
        ).assertExists()
    }

    private fun tops() = LABELS.map { rule.onNodeWithText(it).getUnclippedBoundsInRoot().top }

    private fun assertLabelsWhole() = LABELS.forEach { label ->
        val results = mutableListOf<TextLayoutResult>()
        rule.onNodeWithText(label, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        // One line, inside the drawn size of the label.
        val result = results.single()
        assertEquals(label, 1, result.lineCount)
        assertTrue(label, result.getLineRight(0) - result.getLineLeft(0) <= result.size.width)
        assertTrue(label, result.getLineBottom(0) <= result.size.height)
    }

    @Test
    fun system_isChosen() {
        show(ThemeChoice.SYSTEM)
        assertChosen("System", "Follows your phone")
    }

    @Test
    fun light_isChosen() {
        show(ThemeChoice.LIGHT)
        assertChosen("Light", "Always light")
    }

    @Test
    fun dark_isChosen() {
        show(ThemeChoice.DARK)
        assertChosen("Dark", "Always dark")
    }

    @Test
    fun aTap_reportsTheChoice() {
        show(ThemeChoice.SYSTEM)
        LABELS.forEach { rule.onNodeWithText(it).performClick() }
        assertEquals(ThemeChoice.entries, chosen)
    }

    @Test
    fun segmentsShareOneLine_whenTheLabelsFit() {
        show(ThemeChoice.SYSTEM)
        assertEquals(1, tops().toSet().size)
        assertLabelsWhole()
    }

    @Test
    fun optionsStack_withWholeLabels_atALargeFontOnASmallPhone() {
        show(ThemeChoice.DARK, width = 320.dp, fontScale = 2f)

        val tops = tops()
        assertTrue("$tops", tops[0] < tops[1] && tops[1] < tops[2])
        assertLabelsWhole()
        assertChosen("Dark", "Always dark")

        rule.onNodeWithText("Light").performClick()
        assertEquals(listOf(ThemeChoice.LIGHT), chosen)
    }

    private companion object {
        val LABELS = listOf("System", "Light", "Dark")
    }
}
