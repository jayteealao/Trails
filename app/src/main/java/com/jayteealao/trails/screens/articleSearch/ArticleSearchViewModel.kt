package com.jayteealao.trails.screens.articleSearch

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ArticleSearchViewModel @Inject constructor(
    private val modalClient: ModalClient,
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher

): ViewModel() {
    private var _searchResultsLocal = MutableStateFlow(emptyList<ArticleItem>())
    val searchResultsLocal: StateFlow<List<ArticleItem>>
        get() = _searchResultsLocal

    private var _searchResultsHybrid = MutableStateFlow(emptyList<ArticleItem>())
    val searchResultsHybrid: StateFlow<List<ArticleItem>>
        get() = _searchResultsHybrid

    fun search(query: String) {
        searchWeaviate(query)
        searchLocal(query)
    }

    fun setFavorite(itemId: String, isFavorite: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.setFavorite(itemId, isFavorite)
        }
    }

    fun setReadStatus(itemId: String, isRead: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.setReadStatus(itemId, isRead)
        }
    }

    fun updateTag(itemId: String, tag: String, enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            if (enabled) {
                pocketRepository.addTag(itemId, tag)
            } else {
                pocketRepository.removeTag(itemId, tag)
            }
        }
    }

    private fun searchLocal(query: String) {
        viewModelScope.launch(ioDispatcher) {
            _searchResultsLocal.value = pocketRepository.searchLocal(query)
        }
    }

    private fun searchWeaviate(query: String) {
        viewModelScope.launch(ioDispatcher) {
            _searchResultsHybrid.value = pocketRepository.searchHybrid(query)
        }
    }

}