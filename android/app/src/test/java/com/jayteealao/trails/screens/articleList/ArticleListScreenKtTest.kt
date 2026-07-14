package com.jayteealao.trails.screens.articleList

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.testfixtures.ArticleTestFixtures
import com.jayteealao.trails.screens.articleList.testfixtures.rememberFakeLazyPagingItems
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.testtags.ArticleListTestTags
import io.yumemi.tartlet.ViewStore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * JVM (Robolectric) characterization of [ArticleListScreenContent] — the isolable,
 * Hilt-free content composable of the article list. Renders the real composable with a
 * fake [androidx.paging.compose.LazyPagingItems] and a state-only `ViewStore` (the same
 * construction the production `@Preview`s use), then asserts observable properties by
 * stable `testTag`. This is the golden master for "the list still renders and reacts the
 * same way" that the AGP 9 migration is measured against.
 *
 * Robolectric SDK is pinned to 33 (the app's `targetSdk`) so runs stay on JDK 17; a
 * compact `w400dp` qualifier forces the single-column [LazyColumn] path deterministically.
 *
 * Re-scope of the original 19 always-pass stubs (shape AC-CC3), recorded for audit — no
 * assertion below is a no-op and nothing is `@Ignore`d or weakened:
 *
 *  - Dropped: the 8 `PocketScreenContent` stubs (Empty List / Non Empty List / Item Click
 *    / Lazy Loading / Item Content / Content Padding / Background Color / Modifier
 *    Application). `PocketScreenContent` does not exist in the codebase; the real
 *    composable is [ArticleListScreenContent]. The list-rendering intent behind three of
 *    them (non-empty list, item click, item content) is genuinely covered below.
 *  - Dropped: 8 outer-`ArticleListScreen` behaviors that are NOT part of the isolable
 *    content composable and require the full Hilt graph / a live ViewModel to observe —
 *    Loading State, Error State (this app has no distinct loading/error state; only
 *    `databaseSync`), Search Functionality + SearchBar Interactions (search is the
 *    separate `ArticleSearchScreen`), Synchronization Status (`databaseSync` →
 *    `LinearProgressIndicator` lives in `ArticleListScreen`), and Dialog Visibility /
 *    Content / Dismissal (`ArticleDialog` lives in `ArticleListScreen`, gated by
 *    `selectedArticle`). These render through the real graph and are exercised
 *    best-effort by the instrumented `NavigationTest`, not under Robolectric.
 *  - Kept as real assertions against [ArticleListScreenContent]: empty state, data load,
 *    item content, item click identity, and all-items rendering (5 tests).
 */
@RunWith(RobolectricTestRunner::class)
// Render the content composable in isolation under a plain Application. Without this
// override Robolectric boots the manifest's @HiltAndroidApp `Trails` app, whose onCreate
// eagerly wires FirebaseFirestore and throws "Default FirebaseApp is not initialized" on
// the JVM. These tests inject fakes directly and need no Hilt graph — the plan's stated
// "no Hilt under Robolectric" design.
@Config(sdk = [33], qualifiers = "w400dp-h800dp", application = Application::class)
class ArticleListScreenKtTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private fun emptyState() = ArticleListState()

    // 1 — "Empty Article List": the list root renders but shows no article rows.
    @Test
    fun `empty article list shows no items`() {
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(emptyList()),
                    viewStore = ViewStore { emptyState() },
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    useCardLayout = false,
                )
            }
        }

        composeTestRule.onNodeWithTag(ArticleListTestTags.LIST_ROOT).assertIsDisplayed()
        composeTestRule
            .onNodeWithTag(ArticleListTestTags.item(ArticleTestFixtures.firstItemId))
            .assertDoesNotExist()
    }

    // 4 — "Successful Data Load": rows render for the seeded articles.
    @Test
    fun `successful data load renders rows`() {
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { emptyState() },
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    useCardLayout = false,
                )
            }
        }

        composeTestRule
            .onNodeWithTag(ArticleListTestTags.item(ArticleTestFixtures.firstItemId))
            .assertIsDisplayed()
    }

    // "Item Content": the row shows the article's title.
    @Test
    fun `item content shows article title`() {
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { emptyState() },
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    useCardLayout = false,
                )
            }
        }

        composeTestRule.onNodeWithText(ArticleTestFixtures.firstTitle).assertIsDisplayed()
    }

    // 5 — "Article Click": tapping a row invokes onSelectArticle with that exact article.
    @Test
    fun `article click invokes onSelectArticle with clicked item`() {
        var clicked: ArticleItem? = null
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { emptyState() },
                    onSelectArticle = { clicked = it },
                    onOpenTagManagement = {},
                    useCardLayout = false,
                )
            }
        }

        composeTestRule
            .onNodeWithTag(ArticleListTestTags.item(ArticleTestFixtures.firstItemId))
            .performClick()
        composeTestRule.waitForIdle()

        assertEquals(ArticleTestFixtures.firstItemId, clicked?.itemId)
    }

    // "Non Empty List": every seeded row is rendered, keyed by its stable id.
    @Test
    fun `all seeded articles are rendered`() {
        composeTestRule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreenContent(
                    lazyItems = rememberFakeLazyPagingItems(),
                    viewStore = ViewStore { emptyState() },
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    useCardLayout = false,
                )
            }
        }

        ArticleTestFixtures.articles.forEach { article ->
            composeTestRule
                .onNodeWithTag(ArticleListTestTags.item(article.itemId))
                .assertExists()
        }
    }
}
