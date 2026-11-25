package com.jayteealao.trails.screens.articleList

import android.app.Application
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.FakeLibraryStatus
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.components.ArticleListItem
import com.jayteealao.trails.screens.articleSearch.ArticleSearchScreen
import com.jayteealao.trails.screens.articleSearch.ArticleSearchViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** What a row is and offers to a finger and to a screen reader, wherever rows are shown. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleRowSemanticsTest {

    @get:Rule
    val rule = createComposeRule()

    private class Source : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> =
            LoadResult.Page(listOf(ROW), prevKey = null, nextKey = null)
    }

    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { isSyncing } returns flowOf(false)
        every { allTags() } returns flowOf(listOf("rivers"))
        every { pockets() } answers { Source() }
        every { favoritePockets() } answers { Source() }
        every { archivedPockets() } answers { Source() }
        every { pocketsByTag(any()) } answers { Source() }
    }
    private val listViewModel by lazy {
        ArticleListViewModel(repository, FakeLibraryStatus(LibraryState(hasArticles = true)), Dispatchers.Unconfined)
    }
    private val searchViewModel by lazy { ArticleSearchViewModel(repository, Dispatchers.Unconfined) }
    private val opened = mutableListOf<ArticleItem>()

    private val row = hasText(ROW.title) and hasClickAction()

    private fun show(content: @Composable () -> Unit) = rule.setContent { TrailsTheme(darkTheme = false) { content() } }

    private fun showList(tab: ArticleListTab = ArticleListTab.HOME) {
        listViewModel.setSelectedTab(tab)
        show {
            ArticleListScreen(
                articleListViewModel = listViewModel,
                onSelectArticle = { opened += it },
                onOpenTagManagement = {},
            )
        }
        if (tab == ArticleListTab.TAGS) {
            rule.waitForIdle()
        } else {
            rule.waitUntil(WAIT_MILLIS) { rule.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
        }
    }

    private fun showSearch() {
        coEvery { repository.searchLocal("river") } returns listOf(ROW)
        show {
            ArticleSearchScreen(
                searchBarState = SearchBarState(),
                viewStore = rememberViewStore { searchViewModel },
                onSelectArticle = { opened += it },
            )
        }
        rule.onNode(hasSetTextAction()).performTextInput("river")
        rule.onNode(hasSetTextAction()).performImeAction()
        rule.waitForIdle()
    }

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    private fun customActions() = rule.onNode(row).fetchSemanticsNode().config[SemanticsActions.CustomActions]

    private fun runCustomAction(label: String) {
        rule.runOnIdle { customActions().single { it.label == label }.action() }
        rule.waitForIdle()
    }

    private fun assertRowIsAButtonWithActions() {
        rule.onNode(row).assert(hasRole(Role.Button))
        val config = rule.onNode(row).fetchSemanticsNode().config
        assertEquals("Open article", config[SemanticsActions.OnClick].label)
        assertEquals("Show actions", config[SemanticsActions.OnLongClick].label)
        assertEquals(LABELS, customActions().map { it.label })
    }

    private fun assertSheet(open: Boolean) =
        rule.onAllNodesWithText("Open in browser").assertCountEquals(if (open) 1 else 0)

    @Test
    fun aRowOfTheList_isAButtonWithTheEightActions() {
        showList()
        assertRowIsAButtonWithActions()
    }

    @Test
    fun aRowOfSearch_isAButtonWithTheEightActions() {
        showSearch()
        assertRowIsAButtonWithActions()
    }

    @Test
    fun aRowOfTheCardLayout_isAButtonWithTheEightActions_andItsLongPressIsHeard() {
        val pressed = mutableListOf<ArticleItem>()
        show {
            ArticleListItem(
                article = ROW,
                viewStore = ViewStore { ArticleListState() },
                onClick = {},
                onOpenTagManagement = {},
                useCardLayout = true,
                onLongPress = { pressed += it },
            )
        }
        assertRowIsAButtonWithActions()
        rule.onNode(row).performTouchInput { longClick() }
        assertEquals(listOf(ROW), pressed)
    }

    @Test
    fun aRowWithoutAnAddress_offersNoLinkActions() {
        show {
            ArticleListItem(
                article = ROW.copy(url = ""),
                viewStore = ViewStore { ArticleListState() },
                onClick = {},
                onOpenTagManagement = {},
            )
        }
        assertEquals(LABELS - setOf("Open in browser", "Share", "Copy link"), customActions().map { it.label })
        // The swipe buttons of such a row are there and do nothing.
        rule.onNode(row).performTouchInput { swipeLeft() }
        rule.waitForIdle()
        rule.onNode(hasContentDescription("Copy link")).assert(
            SemanticsMatcher.keyIsDefined(SemanticsProperties.Disabled),
        )
    }

    @Test
    fun eachCustomActionOfAChange_reachesTheRepository_andTurnsItsLabel() {
        showList()

        runCustomAction("Add to favourites")
        coVerify(exactly = 1) { repository.setFavorite("a", true) }
        runCustomAction("Remove from favourites")
        coVerify(exactly = 1) { repository.setFavorite("a", false) }

        runCustomAction("Mark as read")
        coVerify(exactly = 1) { repository.setReadStatus("a", true) }
        runCustomAction("Mark as unread")
        coVerify(exactly = 1) { repository.setReadStatus("a", false) }

        runCustomAction("Archive")
        coVerify(exactly = 1) { repository.archive("a") }
        runCustomAction("Regenerate details")
        coVerify(exactly = 1) { repository.getArticleById("a") }
        runCustomAction("Delete")
        coVerify(exactly = 1) { repository.delete("a") }
        assertEquals(emptyList<ArticleItem>(), opened)
    }

    @Test
    fun theLinkCustomActions_startTheirApps() {
        showList()
        val application = RuntimeEnvironment.getApplication()

        runCustomAction("Open in browser")
        val view = shadowOf(application).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, view.action)
        assertEquals(ROW.url, view.dataString)

        runCustomAction("Share")
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(application).nextStartedActivity.action)

        runCustomAction("Copy link")
        val clipboard = application.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals(ROW.url, clipboard.primaryClip?.getItemAt(0)?.text)
    }

    @Test
    fun aLongPress_opensTheSheet_andDoesNotOpenTheArticle() {
        showList()
        rule.onNode(row).performTouchInput { longClick() }
        rule.waitForIdle()

        assertSheet(open = true)
        rule.onNode(hasText("example.com") and !hasClickAction()).assertIsDisplayed()
        assertEquals(emptyList<ArticleItem>(), opened)
    }

    @Test
    fun aLongPressInSearch_opensTheSheet() {
        showSearch()
        rule.onNode(row).performTouchInput { longClick() }
        rule.waitForIdle()

        assertSheet(open = true)
    }

    @Test
    fun anActionOfTheSheet_isSaved_andTheSheetGoes() {
        showList()
        rule.onNode(row).performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Add to favourites").performClick()
        rule.waitForIdle()

        coVerify(exactly = 1) { repository.setFavorite("a", true) }
        assertSheet(open = false)
    }

    @Test
    fun aDrag_opensNoSheet() {
        showList()
        rule.onNode(row).performTouchInput { swipeRight() }
        rule.waitForIdle()
        assertSheet(open = false)

        // A finger that leaves the row sideways and then rests longer than a long press.
        rule.onNode(row).performTouchInput {
            down(center)
            repeat(10) { moveBy(Offset(-8f * density, 0f)) }
            advanceEventTime(viewConfiguration.longPressTimeoutMillis * 2)
            up()
        }
        rule.waitForIdle()
        assertSheet(open = false)
    }

    @Test
    fun aTap_stillOpensTheArticle() {
        showList()
        rule.onNode(row).performClick()
        rule.waitForIdle()

        assertEquals(listOf("a"), opened.map { it.itemId })
        assertSheet(open = false)
    }

    @Test
    fun aTagRow_isAButton() {
        showList(ArticleListTab.TAGS)
        rule.onNode(hasText("rivers") and hasClickAction()).assert(hasRole(Role.Button))
    }

    private companion object {
        const val WAIT_MILLIS = 5_000L
        val LABELS = listOf(
            "Add to favourites", "Mark as read", "Archive", "Open in browser", "Share", "Copy link",
            "Regenerate details", "Delete",
        )
        val ROW = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a")
    }
}
