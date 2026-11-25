package com.jayteealao.trails.screens.articleList

import androidx.paging.LoadState
import com.jayteealao.trails.data.LibraryLoad
import com.jayteealao.trails.data.LibraryState
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Locale

/** What a list says for each case, and which case comes first. */
class ArticleListBodyTest {

    private val loaded = LoadState.NotLoading(endOfPaginationReached = true)
    private val failed = LoadState.Error(IllegalStateException("raw text"))
    private val empty = LibraryState(hasArticles = false)
    private val signedIn = empty.copy(signedIn = true)

    private lateinit var locale: Locale

    @Before
    fun setUp() {
        locale = Locale.getDefault()
        Locale.setDefault(Locale.US)
    }

    @After
    fun tearDown() {
        Locale.setDefault(locale)
    }

    private fun body(
        tab: ArticleListTab = ArticleListTab.HOME,
        tag: String? = null,
        count: Int = 0,
        refresh: LoadState = loaded,
        library: LibraryState = empty,
    ) = listBodyFor(tab, tag, count, refresh, library)

    private fun message(
        tab: ArticleListTab = ArticleListTab.HOME,
        tag: String? = null,
        refresh: LoadState = loaded,
        library: LibraryState = empty,
    ) = body(tab, tag, 0, refresh, library) as ArticleListBody.Message

    @Test
    fun rows_stayWhileARefreshRunsOrAfterOneFailed() {
        ArticleListTab.entries.forEach { tab ->
            listOf(loaded, failed, LoadState.Loading).forEach { refresh ->
                assertEquals(ArticleListBody.Rows, body(tab, count = 1, refresh = refresh))
            }
        }
    }

    @Test
    fun aFailedLoad_comesBeforeEveryEmptyNotice() {
        val titles = ArticleListTab.entries.map { message(it, refresh = failed, library = signedIn).title }
        assertEquals(
            listOf(
                "Your library did not load",
                "Favourites did not load",
                "Archive did not load",
                "Tags did not load",
            ).sorted(),
            titles.sorted(),
        )
        ArticleListTab.entries.forEach {
            val message = message(it, refresh = failed)
            assertTrue(message.isError)
            assertEquals("The articles are still saved. Try again.", message.text)
            assertEquals(listOf(ListAction.RETRY_LIST), message.actions)
        }
    }

    @Test
    fun aRunningLoad_isTheSkeleton() {
        ArticleListTab.entries.forEach {
            assertEquals(ArticleListBody.Loading, body(it, refresh = LoadState.Loading))
        }
    }

    @Test
    fun firstRun_neverShowsWhileArticlesMayBeOnTheirWay() {
        // Before the row check answers.
        assertEquals(ArticleListBody.Loading, body(library = LibraryState(hasArticles = null)))
        assertEquals(ArticleListBody.Loading, body(library = signedIn.copy(hasArticles = null)))
        // While a sync or restore runs.
        assertEquals(ArticleListBody.Loading, body(library = signedIn.copy(load = LibraryLoad.Loading)))
        assertEquals(ArticleListBody.Loading, body(library = empty.copy(load = LibraryLoad.Loading)))
    }

    @Test
    fun archivedArticles_areNotAFirstRun_whateverTheLoadSays() {
        val failedLoad = LibraryLoad.Failed(offline = true, remoteCount = null)
        listOf(LibraryLoad.Idle, LibraryLoad.Loading, failedLoad).forEach { load ->
            val message = message(library = signedIn.copy(hasArticles = true, load = load))
            assertEquals("No articles on Home", message.title)
            assertEquals("The articles you archived are in Archive.", message.text)
            assertFalse(message.isError)
        }
    }

    @Test
    fun home_notSignedIn_saysHowToSave_andOffersSignIn() {
        val message = message()
        assertEquals("Your library starts here", message.title)
        assertEquals(
            "In any app, share a link and choose Trails. Sign in to bring back articles you saved before.",
            message.text,
        )
        assertEquals(listOf(ListAction.SIGN_IN), message.actions)
        assertFalse(message.isError)
    }

    @Test
    fun home_signedIn_saysHowToSave_withNoSignIn() {
        val message = message(library = signedIn)
        assertEquals("Your library starts here", message.title)
        assertEquals(
            "In any app, share a link and choose Trails. The article waits here, ready to read offline.",
            message.text,
        )
        assertEquals(emptyList<ListAction>(), message.actions)
    }

    @Test
    fun home_offline_offersTryAgain() {
        val message = message(
            library = signedIn.copy(load = LibraryLoad.Failed(offline = true, remoteCount = null)),
        )
        assertEquals("Your library did not load", message.title)
        assertEquals(
            "You’re offline and this phone has no saved articles yet. Connect, then try again.",
            message.text,
        )
        assertEquals(listOf(ListAction.RETRY_LIBRARY), message.actions)
        assertTrue(message.isError)
    }

    @Test
    fun home_failed_saysWhatTheServerHolds() {
        fun text(count: Int?, email: String?): String? {
            val message = message(
                library = signedIn.copy(email = email, load = LibraryLoad.Failed(offline = false, count)),
            )
            assertEquals("Your library did not finish loading", message.title)
            assertEquals(listOf(ListAction.RETRY_LIBRARY, ListAction.OPEN_SETTINGS), message.actions)
            assertTrue(message.isError)
            return message.text
        }

        assertEquals(
            "1,284 articles for jo@example.org are still on the server. Nothing is lost.",
            text(1284, "jo@example.org"),
        )
        assertEquals("1,284 articles are still on the server. Nothing is lost.", text(1284, null))
        assertEquals("1 article for jo@example.org is still on the server. Nothing is lost.", text(1, "jo@example.org"))
        assertEquals("Articles you saved before are still on the server. Nothing is lost.", text(null, "jo@example.org"))
        assertEquals("Try again.", text(0, "jo@example.org"))
    }

    @Test
    fun theOtherTabs_sayTheirOwnWords_whateverTheLibrarySays() {
        listOf(LibraryState(), empty, signedIn.copy(load = LibraryLoad.Loading)).forEach { library ->
            val favourites = message(ArticleListTab.FAVOURITES, library = library)
            assertEquals("No favourites yet", favourites.title)
            assertEquals("Swipe an article to the right, or touch and hold it, to keep it here.", favourites.text)

            val archive = message(ArticleListTab.ARCHIVE, library = library)
            assertEquals("Nothing archived yet", archive.title)
            assertEquals("Articles you archive wait here.", archive.text)

            val tags = message(ArticleListTab.TAGS, library = library)
            assertEquals("No tags yet", tags.title)
            assertEquals("Add a tag to an article to find it here.", tags.text)

            val tag = message(ArticleListTab.TAGS, tag = "rivers", library = library)
            assertEquals("No articles tagged rivers", tag.title)
            assertEquals(null, tag.text)
        }
    }

    @Test
    fun theTagList_hasItsOwnStates() {
        TagsLoad.entries.forEach { assertEquals(ArticleListBody.Rows, tagsBodyFor(2, it)) }
        assertEquals(ArticleListBody.Loading, tagsBodyFor(0, TagsLoad.LOADING))
        assertEquals("No tags yet", (tagsBodyFor(0, TagsLoad.LOADED) as ArticleListBody.Message).title)

        val failedTags = tagsBodyFor(0, TagsLoad.FAILED) as ArticleListBody.Message
        assertEquals("Tags did not load", failedTags.title)
        assertEquals(listOf(ListAction.RETRY_TAGS), failedTags.actions)
        assertTrue(failedTags.isError)
    }
}
