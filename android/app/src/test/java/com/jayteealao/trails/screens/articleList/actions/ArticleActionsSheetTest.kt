package com.jayteealao.trails.screens.articleList.actions

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The words, the rows and the states of the actions sheet. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleActionsSheetTest {

    @get:Rule
    val rule = createComposeRule()

    private val chosen = mutableListOf<ArticleAction>()

    /** The content alone, in a box of [width]. */
    private fun showContent(sheet: ArticleSheet, width: Int = 412, height: Int = 915, fontScale: Float = 1f) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                    Surface {
                        Box(Modifier.size(width.dp, height.dp)) {
                            ArticleActionsSheetContent(sheet, onChoose = { chosen += it })
                        }
                    }
                }
            }
        }
    }

    private fun row(label: String) = rule.onNode(hasText(label) and hasClickAction())

    @Test
    fun eightRowsInOrder_eachAButtonTallEnoughToTouch_andEachIsHeard() {
        showContent(ArticleSheet(ARTICLE))

        val tops = LABELS.map { label ->
            row(label)
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
                .assertHeightIsAtLeast(48.dp)
                .assertIsEnabled()
                .getBoundsInRoot().top
        }
        assertEquals(tops.sorted(), tops)

        LABELS.forEach { row(it).performClick() }
        assertEquals(ArticleAction.entries.toList(), chosen)
    }

    @Test
    fun theTitleIsAHeading_andTheHostFollowsIt() {
        showContent(ArticleSheet(ARTICLE))

        rule.onNodeWithText(ARTICLE.title).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        val title = rule.onNodeWithText(ARTICLE.title).getBoundsInRoot()
        assertTrue(rule.onNodeWithText("rivers.example.org").getBoundsInRoot().top >= title.bottom)
    }

    @Test
    fun withoutAnAddress_theLinkActionsAreDisabled_andSaidWhy() {
        showContent(ArticleSheet(ARTICLE.copy(title = "", url = "")))

        rule.onNodeWithText("Article actions").assertIsDisplayed()
        rule.onNodeWithText("No web address saved").assertIsDisplayed()
        listOf("Open in browser", "Share", "Copy link").forEach { row(it).assertIsNotEnabled() }
        (LABELS - setOf("Open in browser", "Share", "Copy link")).forEach { row(it).assertIsEnabled() }
    }

    @Test
    fun whileTheDetailsLoad_onlyThatRowIsDisabled() {
        showContent(ArticleSheet(ARTICLE, regenerating = true))

        row("Regenerating details…").assertIsNotEnabled()
        (LABELS - "Regenerate details").forEach { row(it).assertIsEnabled() }
    }

    @Test
    fun aFailure_isSaidPolitely_andEveryActionStays() {
        showContent(ArticleSheet(ARTICLE, failure = FAILURE))

        rule.onNodeWithText(FAILURE).assertIsDisplayed().assert(
            SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite),
        )
        LABELS.forEach { row(it).assertIsEnabled() }
    }

    @Test
    fun atTheLargestFontOnASmallPhone_longWordsWrap_andDeleteIsReachable() {
        val long = ArticleItem(
            itemId = "long",
            title = "Benachrichtigungseinstellungen and other compound words: how one very long summer " +
                "rebuilt a forty-year-old newsletter",
            url = "https://reading-room.archive.the-longest-subdomain-in-the-list.example.org/a",
        )
        showContent(ArticleSheet(long), width = 320, height = 568, fontScale = 2f)

        val title = rule.onNodeWithText(long.title).getBoundsInRoot()
        assertTrue(title.right <= 320.dp && title.bottom - title.top > 100.dp)
        val host = rule.onNodeWithText(long.webHost!!).performScrollTo().getBoundsInRoot()
        assertTrue(host.right <= 320.dp && host.bottom - host.top > 48.dp)

        row("Delete").performScrollTo().assertIsDisplayed().performClick()
        assertEquals(listOf(ArticleAction.DELETE), chosen)
    }

    @Test
    fun theSheet_isNamedAfterItsArticle_andGoesWhenItsStateGoes() {
        var sheet by mutableStateOf<ArticleSheet?>(ArticleSheet(ARTICLE))
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleActionsSheet(sheet, onChoose = { chosen += it }, onDismiss = { sheet = null })
            }
        }
        rule.waitForIdle()
        rule.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, ARTICLE.title)).assertExists()
        row("Share").assertIsDisplayed().performClick()
        assertEquals(listOf(ArticleAction.SHARE), chosen)

        sheet = null
        rule.waitForIdle()
        rule.onAllNodesWithText("Share").assertCountEquals(0)

        sheet = ArticleSheet(ARTICLE.copy(itemId = "b", title = "Another river"))
        rule.waitForIdle()
        rule.onNodeWithText("Another river").assertIsDisplayed()
    }

    private companion object {
        const val FAILURE = "Add to favourites was not saved on this phone. Choose it again to retry."
        val ARTICLE = ArticleItem(itemId = "a", title = "A river in winter", url = "https://rivers.example.org/a")
        val LABELS = listOf(
            "Add to favourites", "Mark as read", "Archive", "Open in browser", "Share", "Copy link",
            "Regenerate details", "Delete",
        )
    }
}
