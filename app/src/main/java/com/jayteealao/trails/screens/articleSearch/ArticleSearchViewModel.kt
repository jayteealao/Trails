package com.jayteealao.trails.screens.articleSearch

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ArticleSearchViewModel @Inject constructor(
    private val modalClient: ModalClient,
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<ArticleSearchState, ArticleSearchEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleSearchEvent>()
    override val event: SharedFlow<ArticleSearchEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _searchResultsLocal = MutableStateFlow(emptyList<com.jayteealao.trails.data.models.ArticleItem>())
    private val _searchResultsHybrid = MutableStateFlow(emptyList<com.jayteealao.trails.data.models.ArticleItem>())
    private val _isSearching = MutableStateFlow(false)

    private val tagsFlow = pocketRepository.allTags()
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), emptyList())

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        _searchResultsLocal,
        _searchResultsHybrid,
        _isSearching,
        tagsFlow
    ) { local, hybrid, isSearching, tags ->
        ArticleSearchState(
            searchResultsLocal = local,
            searchResultsHybrid = hybrid,
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
    fun search(query: String) {
        _isSearching.value = true
        viewModelScope.launch(ioDispatcher) {
            try {
                searchWeaviate(query)
                searchLocal(query)
            } catch (e: Exception) {
                _event.emit(ArticleSearchEvent.ShowError(e))
            } finally {
                _isSearching.value = false
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

    private suspend fun searchLocal(query: String) {
        _searchResultsLocal.value = pocketRepository.searchLocal(query)
    }

    private suspend fun searchWeaviate(query: String) {
        _searchResultsHybrid.value = pocketRepository.searchHybrid(query)
    }
}