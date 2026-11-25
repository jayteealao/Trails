package com.jayteealao.trails.screens.articleList

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.FakeLibraryStatus
import com.jayteealao.trails.data.LibraryLoad
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.testtags.ArticleListTestTags
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The empty, failed and loading lists and their messages, over a real ViewModel with a fake library. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleListStatesTest {

    @get:Rule
    val rule = createComposeRule()

    private enum class Load { EMPTY, FAILS, NEVER_ENDS, ROWS }

    /** What every list reads; a retry reads it again. */
    private var load = Load.EMPTY

    private inner class Source : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> = when (load) {
            Load.EMPTY -> LoadResult.Page(emptyList(), prevKey = null, nextKey = null)
            Load.FAILS -> LoadResult.Error(IllegalStateException(RAW))
            Load.NEVER_ENDS -> awaitCancellation()
            Load.ROWS -> LoadResult.Page(listOf(ROW), prevKey = null, nextKey = null)
        }
    }

    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { isSyncing } returns flowOf(false)
        every { allTags() } returns flowOf(listOf("rivers"))
        every { pockets() } answers { Source() }
        every { favoritePockets() } answers { Source() }
        every { archivedPockets() } answers { Source() }
        every { pocketsByTag(any()) } answers { Source() }
    }
    private val library = FakeLibraryStatus(LibraryState(hasArticles = false))
    private var signIns = 0
    private var settings = 0

    private val viewModel by lazy {
        ArticleListViewModel(
            articleRepository = repository,
            libraryStatus = library,
            unfurlers = { mockk() },
            ioDispatcher = Dispatchers.Unconfined,
        )
    }

    private fun show(tab: ArticleListTab = ArticleListTab.HOME) {
        viewModel.setSelectedTab(tab)
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreen(
                    articleListViewModel = viewModel,
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                    onSignIn = { signIns++ },
                    onOpenSettings = { settings++ },
                )
            }
        }
        rule.waitForIdle()
    }

    private val tryAgain = hasText("Try again") and hasClickAction()

    private fun assertNoRawText() =
        rule.onAllNodesWithText(RAW, substring = true, useUnmergedTree = true).assertCountEquals(0)

    private fun assertFailsThenLoads(title: String) {
        rule.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        assertNoRawText()
        load = Load.ROWS
        rule.onNode(tryAgain).performClick()
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(ROW.title).fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodesWithText(title, useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun noArticles_saysHowToSave_andSignInOpensTheRoute() {
        show()

        rule.onNodeWithText("Your library starts here", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithText("share a link and choose Trails", substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
        rule.onNodeWithTag(ArticleListTestTags.LIST_ROOT).assertIsDisplayed()
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick()
        assertEquals(1, signIns)
        assertEquals(1, library.restores)
    }

    @Test
    fun theSignedInLibrary_loads_fails_andOffersTryAgainAndSettings() {
        library.state.value = LibraryState(hasArticles = false, signedIn = true, load = LibraryLoad.Loading)
        show()
        rule.onNodeWithContentDescription("Loading articles").assertIsDisplayed()

        library.state.value = library.state.value.copy(load = LibraryLoad.Failed(offline = false, remoteCount = null))
        rule.waitForIdle()
        rule.onNodeWithText("Your library did not finish loading", useUnmergedTree = true).assertIsDisplayed()
        rule.onNode(tryAgain).performClick()
        rule.onNode(hasText("Open Settings") and hasClickAction()).performClick()
        assertEquals(1, library.retries)
        assertEquals(1, settings)
    }

    @Test
    fun home_failedLoad_offersTryAgain_andLoadsTheRows() {
        load = Load.FAILS
        show(ArticleListTab.HOME)
        assertFailsThenLoads("Your library did not load")
    }

    @Test
    fun favourites_failedLoad_offersTryAgain_andLoadsTheRows() {
        load = Load.FAILS
        show(ArticleListTab.FAVOURITES)
        assertFailsThenLoads("Favourites did not load")
    }

    @Test
    fun archive_failedLoad_offersTryAgain_andLoadsTheRows() {
        load = Load.FAILS
        show(ArticleListTab.ARCHIVE)
        assertFailsThenLoads("Archive did not load")
    }

    @Test
    fun aTag_failedLoad_offersTryAgain_andLoadsTheRows() {
        load = Load.FAILS
        show(ArticleListTab.TAGS)
        rule.onNodeWithText("rivers").performClick()
        rule.waitForIdle()
        assertFailsThenLoads("Articles tagged rivers did not load")
    }

    @Test
    fun theTagList_failedRead_offersTryAgain_andLoadsTheTags() {
        every { repository.allTags() } returns
            flow { throw IllegalStateException(RAW) } andThen flowOf(listOf("rivers"))
        show(ArticleListTab.TAGS)

        rule.onNodeWithText("Tags did not load", useUnmergedTree = true).assertIsDisplayed()
        assertNoRawText()
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("rivers").assertIsDisplayed()
    }

    @Test
    fun beforeTheFirstLoad_noTabFlashesANotice() {
        load = Load.NEVER_ENDS
        show(ArticleListTab.HOME)

        listOf(ArticleListTab.HOME, ArticleListTab.FAVOURITES, ArticleListTab.ARCHIVE).forEach { tab ->
            viewModel.setSelectedTab(tab)
            rule.waitForIdle()
            rule.onNodeWithContentDescription("Loading articles").assertIsDisplayed()
            NOTICES.forEach { rule.onAllNodesWithText(it, useUnmergedTree = true).assertCountEquals(0) }
        }
    }

    @Test
    fun aFailedChange_isOnScreen_aboveTheBottomBar_withNoExceptionText() {
        coEvery { repository.setFavorite(any(), any()) } throws IllegalStateException(RAW) andThen Unit
        show()

        viewModel.setFavorite("a", true)
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(CHANGE_FAILED).fetchSemanticsNodes().isNotEmpty() }

        rule.onNodeWithText(CHANGE_FAILED).assertIsDisplayed()
        assertNoRawText()
        val message = rule.onNodeWithText(CHANGE_FAILED).getBoundsInRoot()
        val bar = rule.onNode(hasText("Archive") and hasClickAction()).getBoundsInRoot()
        assertTrue(message.bottom <= bar.top)

        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        coVerify(exactly = 2) { repository.setFavorite("a", true) }
    }

    @Test
    fun aToast_isOnScreen() {
        show()

        viewModel.archiveArticle("a")
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(ARCHIVED).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText(ARCHIVED).assertIsDisplayed()
    }

    @Test
    fun aDelete_offersUndo_aboveTheBottomBar_andUndoRestores() {
        show()

        viewModel.deleteArticle("a")
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(DELETED).fetchSemanticsNodes().isNotEmpty() }
        val message = rule.onNodeWithText(DELETED).assertIsDisplayed().getBoundsInRoot()
        val bar = rule.onNode(hasText("Archive") and hasClickAction()).getBoundsInRoot()
        assertTrue(message.bottom <= bar.top)

        rule.onNode(hasText("Undo") and hasClickAction()).performClick()
        rule.waitForIdle()
        coVerify(exactly = 1) { repository.restore("a") }
        rule.onAllNodesWithText(DELETED).assertCountEquals(0)
    }

    @Test
    fun aRegenerateThatCannotReadThePage_saysSo_andKeepsTheStoredDetails() {
        coEvery { repository.getArticleById("a") } returns
            Article(itemId = "a", url = "not a link", givenUrl = "not a link")
        show()

        viewModel.regenerateArticleDetails("a")
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodesWithText(NOT_UPDATED).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText(NOT_UPDATED).assertIsDisplayed()
        coVerify(exactly = 0) { repository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    }

    private companion object {
        const val RAW = "raw text of the exception"
        const val CHANGE_FAILED = "That change was not saved on this phone."
        const val NOT_UPDATED = "The article details were not updated."
        const val ARCHIVED = "Article archived"
        const val DELETED = "Article deleted"
        const val WAIT_MILLIS = 5_000L
        val NOTICES = listOf("Your library starts here", "No favourites yet", "Nothing archived yet")
        val ROW = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a")
    }
}
