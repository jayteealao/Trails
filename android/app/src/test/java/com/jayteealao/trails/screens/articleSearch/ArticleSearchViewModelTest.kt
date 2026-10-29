package com.jayteealao.trails.screens.articleSearch

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Only the newest search reaches the screen: a search that is replaced before it finishes
 * never shows its results or its error, even when its database call ignores cancellation.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArticleSearchViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<ArticleRepository>()

    private val old = ArticleItem(itemId = "old", title = "Old result", url = "https://example.com/old")
    private val new = ArticleItem(itemId = "new", title = "New result", url = "https://example.com/new")

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { repository.allTags() } returns flowOf(emptyList())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class Collected(val states: List<ArticleSearchState>, val events: List<ArticleSearchEvent>)

    /** Builds the ViewModel on the test dispatcher and collects its state and events for the whole test. */
    private fun TestScope.viewModel(): Pair<ArticleSearchViewModel, Collected> {
        val viewModel = ArticleSearchViewModel(repository, dispatcher)
        val states = mutableListOf<ArticleSearchState>()
        val events = mutableListOf<ArticleSearchEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect { states += it } }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.event.collect { events += it } }
        return viewModel to Collected(states, events)
    }

    @Test
    fun slowSearchReplacedByNewerOne_onlyTheNewerResultIsShown() = runTest(dispatcher) {
        coEvery { repository.searchLocal("slow") } coAnswers { delay(1_000); listOf(old) }
        coEvery { repository.searchLocal("new") } coAnswers { delay(10); listOf(new) }
        val (viewModel, collected) = viewModel()

        viewModel.search("slow")
        advanceTimeBy(5)
        viewModel.search("new")
        advanceUntilIdle()

        assertEquals(listOf(new), viewModel.state.value.searchResults)
        assertFalse(viewModel.state.value.isSearching)
        assertTrue(collected.states.none { old in it.searchResults })
    }

    @Test
    fun replacedSearchThatIgnoresCancellation_isStillNeverShown() = runTest(dispatcher) {
        coEvery { repository.searchLocal("slow") } coAnswers {
            withContext(NonCancellable) { delay(1_000); listOf(old) }
        }
        coEvery { repository.searchLocal("new") } coAnswers { delay(10); listOf(new) }
        val (viewModel, collected) = viewModel()

        viewModel.search("slow")
        advanceTimeBy(5)
        viewModel.search("new")
        advanceUntilIdle()

        assertEquals(listOf(new), viewModel.state.value.searchResults)
        assertFalse(viewModel.state.value.isSearching)
        assertTrue(collected.states.none { old in it.searchResults })
    }

    @Test
    fun errorOfTheCurrentSearch_isShown_errorOfAReplacedSearchIsNot() = runTest(dispatcher) {
        val replacedError = IllegalStateException("replaced")
        val currentError = IllegalStateException("current")
        coEvery { repository.searchLocal("slow") } coAnswers {
            withContext(NonCancellable) { delay(1_000); throw replacedError }
        }
        coEvery { repository.searchLocal("new") } coAnswers { delay(10); throw currentError }
        val (viewModel, collected) = viewModel()

        viewModel.search("slow")
        advanceTimeBy(5)
        viewModel.search("new")
        advanceUntilIdle()

        val errors = collected.events.filterIsInstance<ArticleSearchEvent.ShowError>().map { it.error }
        assertEquals(listOf<Throwable>(currentError), errors)
        assertFalse(viewModel.state.value.isSearching)
    }

    @Test
    fun oneSearch_showsSearchingWhileItRuns_thenTheResults() = runTest(dispatcher) {
        coEvery { repository.searchLocal("river") } coAnswers { delay(100); listOf(new) }
        val (viewModel, _) = viewModel()

        viewModel.search("river")
        advanceTimeBy(50)
        runCurrent()
        assertTrue(viewModel.state.value.isSearching)

        advanceUntilIdle()
        assertEquals(listOf(new), viewModel.state.value.searchResults)
        assertFalse(viewModel.state.value.isSearching)
    }
}
