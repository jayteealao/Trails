package com.jayteealao.trails.screens.articleList.components

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import com.jayteealao.trails.screens.articleList.testfixtures.ArticleTestFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * JVM (Robolectric) render of [ArticleDialog]: the dialog keeps its title and its three
 * action buttons, and no longer shows a summary field or a "Save to Pocket" button.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the @HiltAndroidApp `Trails` app; see
// ArticleListScreenKtTest for the full rationale.
@Config(sdk = [33], qualifiers = "w400dp-h800dp", application = Application::class)
class ArticleDialogTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `dialog renders without a summary field or a Pocket button`() {
        val article = ArticleTestFixtures.articles.first()
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleDialog(article = article, showDialog = true, onDismissRequest = {})
            }
        }

        composeTestRule.onNodeWithText(article.title).assertIsDisplayed()
        composeTestRule.onNodeWithText("Summary").assertDoesNotExist()
        composeTestRule.onNodeWithContentDescription("Save to Pocket").assertDoesNotExist()
        composeTestRule.onNodeWithContentDescription("Open in Browser").assertExists()
        composeTestRule.onNodeWithContentDescription("Share").assertExists()
        composeTestRule.onNodeWithContentDescription("More Options").assertExists()
    }
}
