package com.jayteealao.trails.screens.articleSearch

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.components.ErrorMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject

@HiltViewModel
class ArticleSearchViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<ArticleSearchState, ArticleSearchEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleSearchEvent>()
    override val event: SharedFlow<ArticleSearchEvent> = _event.asSharedFlow()

    /** The newest search: its words, where it stands and what it found. */
    private data class Search(
        val query: String? = null,
        val running: Boolean = false,
        val failed: Boolean = false,
        val results: List<ArticleItem> = emptyList(),
    )

    private val newestSearch = MutableStateFlow(Search())

    // The running search and the number of the newest one: a search that was replaced never
    // writes its results, its error or the searching flag, even if its database call ignores
    // cancellation.
    private var searchJob: Job? = null
    private val searchGeneration = AtomicLong()

    private val tagsFlow = pocketRepository.allTags()
        .catch { error ->
            Timber.e(error, "Could not read the tags")
            emit(emptyList())
        }
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), emptyList())

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(newestSearch, tagsFlow) { search, tags ->
        ArticleSearchState(
            searchResults = search.results,
            isSearching = search.running,
            searchedQuery = search.query,
            searchFailed = search.failed,
            tags = tags
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleSearchState()
    )

    override val state: StateFlow<ArticleSearchState> = _state

    // Actions
    /**
     * Runs [query], cancelling the search before it; only the newest search reaches the state. A
     * search without words clears the search.
     */
    fun search(query: String) {
        if (query.isBlank()) return clearSearch()
        searchJob?.cancel()
        val generation = searchGeneration.incrementAndGet()
        newestSearch.update { it.copy(query = query, running = true, failed = false) }
        searchJob = viewModelScope.launch(ioDispatcher) {
            try {
                val results = pocketRepository.searchLocal(query)
                ensureActive()
                updateIfNewest(generation) { it.copy(results = results, running = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "The search failed")
                updateIfNewest(generation) { it.copy(failed = true, running = false) }
            }
        }
    }

    /** Drops the running search and everything the last one found. */
    fun clearSearch() {
        searchJob?.cancel()
        searchGeneration.incrementAndGet()
        newestSearch.value = Search()
    }

    private fun updateIfNewest(generation: Long, change: (Search) -> Search) {
        newestSearch.update { if (generation == searchGeneration.get()) change(it) else it }
    }

    /** Runs one change; a failure is told, with a retry that runs the same change again. */
    private fun change(name: String, block: suspend () -> Unit) {
        viewModelScope.launch(ioDispatcher) {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "%s failed", name)
                _event.emit(ArticleSearchEvent.ShowError(ErrorMessage.CHANGE_FAILED) { change(name, block) })
            }
        }
    }

    fun setFavorite(itemId: String, isFavorite: Boolean) = change("setFavorite") {
        pocketRepository.setFavorite(itemId, isFavorite)
    }

    fun updateTag(itemId: String, tag: String, enabled: Boolean) = change("updateTag") {
        if (enabled) {
            pocketRepository.addTag(itemId, tag)
        } else {
            pocketRepository.removeTag(itemId, tag)
        }
    }

    fun setReadStatus(itemId: String, isRead: Boolean) = change("setReadStatus") {
        pocketRepository.setReadStatus(itemId, isRead)
    }

    fun archiveArticle(itemId: String) = change("archiveArticle") {
        pocketRepository.archive(itemId)
    }

    fun deleteArticle(itemId: String) = change("deleteArticle") {
        pocketRepository.delete(itemId)
    }

    fun shareArticle(title: String, url: String) {
        viewModelScope.launch {
            _event.emit(ArticleSearchEvent.ShareArticle(title, url))
        }
    }

    fun copyLink(url: String, label: String = "Article URL") {
        viewModelScope.launch {
            _event.emit(ArticleSearchEvent.CopyLink(url, label))
        }
    }

    fun regenerateArticleDetails(itemId: String) {
        viewModelScope.launch {
            _event.emit(ArticleSearchEvent.ShowToast("Regenerate details not available in search. Open article in list view."))
        }
    }
}