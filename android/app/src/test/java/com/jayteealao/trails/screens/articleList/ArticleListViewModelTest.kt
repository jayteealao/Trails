package com.jayteealao.trails.screens.articleList

import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.FakeLibraryStatus
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleAction
import com.jayteealao.trails.screens.articleList.actions.ArticleSheet
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.saket.unfurl.UnfurlResult
import me.saket.unfurl.Unfurler
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticleListViewModelTest {

    @MockK private lateinit var articleRepository: ArticleRepository

    private val libraryStatus = FakeLibraryStatus()

    private val unfurler = mockk<Unfurler>()

    private lateinit var testDispatcher: CoroutineDispatcher

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        testDispatcher = StandardTestDispatcher()
        Dispatchers.setMain(testDispatcher)

        every { articleRepository.synchronize() } returns Unit
        every { articleRepository.isSyncing } returns flowOf(false)
        every { articleRepository.pockets() } answers { TestPagingSource() }
        every { articleRepository.favoritePockets() } answers { TestPagingSource() }
        every { articleRepository.archivedPockets() } answers { TestPagingSource() }
        every { articleRepository.pocketsByTag(any()) } answers { TestPagingSource() }
        every { articleRepository.allTags() } returns flowOf(emptyList())
        coEvery { articleRepository.searchLocal(any()) } returns emptyList()
        coEvery { articleRepository.getTags(any()) } returns emptyList()
        coEvery { articleRepository.setFavorite(any(), any()) } returns Unit
        coEvery { articleRepository.addTag(any(), any()) } returns Unit
        coEvery { articleRepository.removeTag(any(), any()) } returns Unit
        coEvery { articleRepository.updateExcerpt(any(), any()) } returns Unit
        coEvery { articleRepository.getArticleById(any()) } returns Article(
            itemId = "test", url = "https://example.com/article", givenUrl = "https://example.com/article"
        )
        coEvery { articleRepository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) } returns Unit
        coEvery { articleRepository.upsertArticle(any()) } returns Unit
    }

    @After
    fun tearDown() {
        clearAllMocks()
        Dispatchers.resetMain()
    }

    @Test
    fun `databaseSync follows the Firestore sync state`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // A fake FirestoreSyncManager whose sync state the test drives; the repository
        // stub hands its flow through, as ArticleRepositoryImpl.isSyncing does.
        val syncing = MutableStateFlow(false)
        val fakeSyncManager = mockk<FirestoreSyncManager>()
        every { fakeSyncManager.isSyncing } returns syncing
        every { articleRepository.isSyncing } returns fakeSyncManager.isSyncing

        val viewModel = ArticleListViewModel(
            articleRepository = articleRepository,
            libraryStatus = libraryStatus,
            unfurlers = { unfurler },
            ioDispatcher = dispatcher,
        )
        // The state is shared WhileSubscribed, so keep a collector alive for the test.
        backgroundScope.launch(dispatcher) { viewModel.state.collect {} }
        advanceUntilIdle()
        assertFalse(viewModel.state.value.databaseSync)

        syncing.value = true
        advanceUntilIdle()
        assertTrue(viewModel.state.value.databaseSync)

        syncing.value = false
        advanceUntilIdle()
        assertFalse(viewModel.state.value.databaseSync)
    }

    /** A ViewModel on [dispatcher], and every event it sends. */
    private fun TestScope.viewModelWithEvents(
        dispatcher: CoroutineDispatcher,
    ): Pair<ArticleListViewModel, List<ArticleListEvent>> {
        val viewModel = ArticleListViewModel(
            articleRepository = articleRepository,
            libraryStatus = libraryStatus,
            unfurlers = { unfurler },
            ioDispatcher = dispatcher,
        )
        val events = mutableListOf<ArticleListEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.event.collect { events += it } }
        return viewModel to events
    }

    @Test
    fun `each failed change says so in fixed words and its retry repeats it`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val raw = IllegalStateException("raw text")
        coEvery { articleRepository.setFavorite("a", true) } throws raw andThen Unit
        coEvery { articleRepository.setReadStatus("a", true) } throws raw andThen Unit
        coEvery { articleRepository.archive("a") } throws raw andThen Unit
        coEvery { articleRepository.delete("a") } throws raw andThen Unit
        val (viewModel, events) = viewModelWithEvents(dispatcher)

        val changes = listOf<() -> Unit>(
            { viewModel.setFavorite("a", true) },
            { viewModel.setReadStatus("a", true) },
            { viewModel.archiveArticle("a") },
            { viewModel.deleteArticle("a") },
        )
        changes.forEach { it() }
        advanceUntilIdle()

        val errors = events.filterIsInstance<ArticleListEvent.ShowError>()
        assertEquals(List(changes.size) { ErrorMessage.CHANGE_FAILED }, errors.map { it.message })
        errors.forEach { it.retry!!.invoke() }
        advanceUntilIdle()

        coVerify(exactly = 2) { articleRepository.setFavorite("a", true) }
        coVerify(exactly = 2) { articleRepository.setReadStatus("a", true) }
        coVerify(exactly = 2) { articleRepository.archive("a") }
        coVerify(exactly = 2) { articleRepository.delete("a") }
        assertEquals(changes.size, events.filterIsInstance<ArticleListEvent.ShowError>().size)
    }

    /** Makes the injected unfurler answer [answer]. */
    private fun unfurlerAnswers(answer: suspend () -> UnfurlResult?) {
        coEvery { unfurler.unfurl(any<String>()) } coAnswers { answer() }
    }

    @Test
    fun `a regenerate stores the new details and says so`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        unfurlerAnswers { mockk(relaxed = true) { every { title } returns "New title" } }
        val (viewModel, events) = viewModelWithEvents(dispatcher)

        viewModel.regenerateArticleDetails("test")
        advanceUntilIdle()

        coVerify(exactly = 1) {
            articleRepository.updateUnfurledDetails("test", "New title", any(), any(), any(), any(), any())
        }
        assertEquals(listOf<ArticleListEvent>(ArticleListEvent.ShowSnackbar("Article details updated")), events)
    }

    @Test
    fun `an offline regenerate says it failed and its retry reads the page again`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        var reads = 0
        unfurlerAnswers { reads++; null }
        val (viewModel, events) = viewModelWithEvents(dispatcher)

        viewModel.regenerateArticleDetails("test")
        advanceUntilIdle()

        val error = events.single() as ArticleListEvent.ShowError
        assertEquals(ErrorMessage.DETAILS_NOT_UPDATED, error.message)
        error.retry!!.invoke()
        advanceUntilIdle()
        assertEquals(2, reads)
        coVerify(exactly = 0) { articleRepository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `the actions sheet is in the state and an undo restores`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        coEvery { articleRepository.delete("a") } returns Unit
        coEvery { articleRepository.restore("a") } returns Unit
        val (viewModel, events) = viewModelWithEvents(dispatcher)
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect {} }
        val article = ArticleItem(itemId = "a", title = "A river", url = "https://example.com/a")

        viewModel.openActions(article)
        advanceUntilIdle()
        assertEquals(ArticleSheet(article), viewModel.state.value.actionSheet)

        viewModel.chooseAction(ArticleAction.DELETE)
        advanceUntilIdle()
        assertEquals(null, viewModel.state.value.actionSheet)
        (events.single() as ArticleListEvent.ArticleDeleted).undo()
        advanceUntilIdle()
        coVerify(exactly = 1) { articleRepository.restore("a") }
    }

    @Test
    fun `a failing tag read is failed and the retry loads the tags`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        every { articleRepository.allTags() } returns
            flow { throw IllegalStateException("raw text") } andThen flowOf(listOf("rivers"))
        val (viewModel, _) = viewModelWithEvents(dispatcher)
        backgroundScope.launch(dispatcher) { viewModel.state.collect {} }
        advanceUntilIdle()
        assertEquals(TagsLoad.FAILED, viewModel.state.value.tagsLoad)

        viewModel.retryTags()
        advanceUntilIdle()

        assertEquals(TagsLoad.LOADED, viewModel.state.value.tagsLoad)
        assertEquals(listOf("rivers"), viewModel.state.value.tags)
    }

    @Test
    fun `the library status is in the state and only the screen starts a restore`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val (viewModel, _) = viewModelWithEvents(dispatcher)
        backgroundScope.launch(dispatcher) { viewModel.state.collect {} }
        libraryStatus.state.value = LibraryState(hasArticles = false, signedIn = true)
        advanceUntilIdle()

        assertEquals(LibraryState(hasArticles = false, signedIn = true), viewModel.state.value.library)
        assertEquals(0, libraryStatus.restores)
        viewModel.showLibrary()
        viewModel.retryLibrary()
        assertEquals(1, libraryStatus.restores)
        assertEquals(1, libraryStatus.retries)
    }

    // Tag suggestion tests have been moved to TagManagementViewModelTest

    private class TestPagingSource : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> =
            LoadResult.Page(emptyList(), prevKey = null, nextKey = null)
    }
}
