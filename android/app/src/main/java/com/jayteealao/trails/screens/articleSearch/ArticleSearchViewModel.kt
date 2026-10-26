package com.jayteealao.trails.screens.articleSearch

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
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

    // Internal mutable states
    private val _searchResults = MutableStateFlow(emptyList<com.jayteealao.trails.data.models.ArticleItem>())
    private val _isSearching = MutableStateFlow(false)

    // The running search and the number of the newest one: a search that was replaced never
    // writes its results, its error or the searching flag, even if its database call ignores
    // cancellation.
    private var searchJob: Job? = null
    private val searchGeneration = AtomicLong()

    private val tagsFlow = pocketRepository.allTags()
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), emptyList())

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        _searchResults,
        _isSearching,
        tagsFlow
    ) { results, isSearching, tags ->
        ArticleSearchState(
            searchResults = results,
            isSearching = isSearching,
            tags = tags
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleSearchState()
    )

    override val state: StateFlow<ArticleSearchState> = _state

    // Actions
    /** Runs [query], cancelling the search before it; only the newest search reaches the state. */
    fun search(query: String) {
        searchJob?.cancel()
        val generation = searchGeneration.incrementAndGet()
        _isSearching.value = true
        searchJob = viewModelScope.launch(ioDispatcher) {
            try {
                val results = pocketRepository.searchLocal(query)
                ensureActive()
                if (generation == searchGeneration.get()) _searchResults.value = results
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == searchGeneration.get()) _event.emit(ArticleSearchEvent.ShowError(e))
            } finally {
                if (generation == searchGeneration.get()) _isSearching.value = false
            }
        }
    }

    fun setFavorite(itemId: String, isFavorite: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                pocketRepository.setFavorite(itemId, isFavorite)
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            }
        }
    }

    fun updateTag(itemId: String, tag: String, enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                if (enabled) {
                    pocketRepository.addTag(itemId, tag)
                } else {
                    pocketRepository.removeTag(itemId, tag)
                }
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            }
        }
    }

    fun setReadStatus(itemId: String, isRead: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                pocketRepository.setReadStatus(itemId, isRead)
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            }
        }
    }

    fun archiveArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                pocketRepository.archive(itemId)
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            }
        }
    }

    fun deleteArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                pocketRepository.delete(itemId)
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            }
        }
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