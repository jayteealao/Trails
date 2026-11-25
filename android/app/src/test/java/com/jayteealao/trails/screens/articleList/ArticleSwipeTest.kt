package com.jayteealao.trails.screens.articleList

import android.app.Application
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.FakeLibraryStatus
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.testtags.ArticleListTestTags
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** What a swipe of a row does, over a real ViewModel: the favourite to the right, six buttons to the left. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class ArticleSwipeTest {

    @get:Rule
    val rule = createComposeRule()

    private inner class Source : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> =
            LoadResult.Page(listOf(row), prevKey = null, nextKey = null)
    }

    private var row = ROW

    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { isSyncing } returns flowOf(false)
        every { allTags() } returns flowOf(emptyList())
        every { pockets() } answers { Source() }
        every { favoritePockets() } answers { Source() }
        every { archivedPockets() } answers { Source() }
        every { pocketsByTag(any()) } answers { Source() }
    }

    private val viewModel by lazy {
        ArticleListViewModel(
            articleRepository = repository,
            libraryStatus = FakeLibraryStatus(LibraryState(hasArticles = true)),
            unfurlers = { mockk() },
            ioDispatcher = Dispatchers.Unconfined,
        )
    }

    private val item = hasTestTag(ArticleListTestTags.item(ROW.itemId))

    private fun show() {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                ArticleListScreen(
                    articleListViewModel = viewModel,
                    onSelectArticle = {},
                    onOpenTagManagement = {},
                )
            }
        }
        rule.waitUntil(WAIT_MILLIS) { rule.onAllNodes(item).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun button(description: String) =
        rule.onNode(hasContentDescription(description) and hasClickAction() and hasAnyAncestor(item))

    /** Left swipe, then the button; the row is back before this returns. */
    private fun tapAfterLeftSwipe(description: String) {
        rule.onNode(item).performTouchInput { swipeLeft() }
        rule.waitForIdle()
        button(description).performClick()
        settle()
    }

    /** Lets the reset of the row run to its end. */
    private fun settle() {
        rule.mainClock.advanceTimeBy(RESET_MILLIS)
        rule.waitForIdle()
    }

    private fun titleLeft() = rule.onNodeWithText(ROW.title, useUnmergedTree = true).getBoundsInRoot().left

    @Test
    fun aRightSwipe_setsTheOppositeFavourite_andTheRowReturns() {
        show()
        val before = titleLeft()

        rule.onNode(item).performTouchInput { swipeRight() }
        settle()
        coVerify(exactly = 1) { repository.setFavorite(ROW.itemId, true) }
        assertEquals(before, titleLeft())

        rule.onNode(item).performTouchInput { swipeRight() }
        settle()
        coVerify(exactly = 1) { repository.setFavorite(ROW.itemId, false) }
        assertEquals(before, titleLeft())
    }

    @Test
    fun aRightSwipeOfAFavourite_removesIt() {
        row = ROW.copy(favorite = true)
        show()

        rule.onNode(item).performTouchInput { swipeRight() }
        settle()

        coVerify(exactly = 1) { repository.setFavorite(ROW.itemId, false) }
    }

    @Test
    fun aLeftSwipe_showsSixButtonsInOrder_andTheRowReturnsByItself() {
        show()
        val before = titleLeft()

        rule.onNode(item).performTouchInput { swipeLeft() }
        rule.waitForIdle()

        val lefts = SWIPE_BUTTONS.map { button(it).assertIsDisplayed().getBoundsInRoot().left }
        assertEquals(lefts.sorted(), lefts)
        assertTrue(titleLeft() < before)

        rule.mainClock.advanceTimeBy(AUTO_RESET_MILLIS)
        rule.waitForIdle()
        assertEquals(before, titleLeft())
    }

    @Test
    fun theChangeButtons_reachTheRepository_andTheRowReturns() {
        show()
        val before = titleLeft()

        tapAfterLeftSwipe("Mark as read")
        coVerify(exactly = 1) { repository.setReadStatus(ROW.itemId, true) }
        assertEquals(before, titleLeft())

        tapAfterLeftSwipe("Mark as unread")
        coVerify(exactly = 1) { repository.setReadStatus(ROW.itemId, false) }

        tapAfterLeftSwipe("Archive")
        coVerify(exactly = 1) { repository.archive(ROW.itemId) }

        tapAfterLeftSwipe("Delete")
        coVerify(exactly = 1) { repository.delete(ROW.itemId) }

        tapAfterLeftSwipe("Regenerate details")
        coVerify(exactly = 1) { repository.getArticleById(ROW.itemId) }
        assertEquals(before, titleLeft())
    }

    @Test
    fun copyLink_putsTheAddressOnTheClipboard() {
        show()

        tapAfterLeftSwipe("Copy link")

        val clipboard = RuntimeEnvironment.getApplication()
            .getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals(ROW.url, clipboard.primaryClip?.getItemAt(0)?.text)
        rule.onNodeWithText("Article URL copied to clipboard").assertIsDisplayed()
    }

    @Test
    fun share_opensTheChooserWithTheTitleAndTheAddress() {
        show()

        tapAfterLeftSwipe("Share")

        val chooser = shadowOf(RuntimeEnvironment.getApplication()).nextStartedActivity
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        val send = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)!!
        assertEquals("${ROW.title}\n\n${ROW.url}", send.getStringExtra(Intent.EXTRA_TEXT))
    }

    private companion object {
        const val WAIT_MILLIS = 5_000L
        const val RESET_MILLIS = 2_000L
        const val AUTO_RESET_MILLIS = 8_000L
        val SWIPE_BUTTONS = listOf("Mark as read", "Archive", "Delete", "Regenerate details", "Copy link", "Share")
        val ROW = ArticleItem(itemId = "a", title = "A river in winter", url = "https://example.com/a")
    }
}
