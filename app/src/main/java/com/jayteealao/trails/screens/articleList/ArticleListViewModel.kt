/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.jayteealao.trails.screens.articleList

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.PocketUiState.Loading
import com.jayteealao.trails.services.semanticSearch.modal.ModalClient
import com.jayteealao.trails.services.supabase.SupabaseService
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import com.jayteealao.trails.usecases.SynchronizePocketUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    private val synchronizePocketUseCase: SynchronizePocketUseCase,
    private val getArticleWithTextUseCase: GetArticleWithTextUseCase,
    private val modalClient: ModalClient,
    private val supabaseService: SupabaseService,
    private val pocketDao: PocketDao,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel() {

    init {
        viewModelScope.launch(ioDispatcher) {
            supabaseService.observeChanges {
                Timber.d("Supabase changes: $it")
            }
        }
    }

    private val _uiState = MutableStateFlow<PocketUiState>(Loading)
    val uiState: StateFlow<PocketUiState>
        get() = _uiState

    private val _selectedArticle = MutableStateFlow<ArticleItem>(EMPTYARTICLEITEM)
    val selectedArticle: StateFlow<ArticleItem>
        get() = _selectedArticle

    private val _selectedArticleSummary = MutableStateFlow(PocketSummary())
    val selectedArticleSummary: StateFlow<PocketSummary>
        get() = _selectedArticleSummary

//    TODO: move to usecase
    val databaseSync = pocketRepository.isSyncing
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun sync() {
        viewModelScope.launch(ioDispatcher) {
//            pocketDao.clearModalTable()
            synchronizePocketUseCase()
        }
    }

    val test = MutableStateFlow("")

    private var _articles = MutableStateFlow(emptyList<PocketArticle>())
    val articles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(
            pageSize = 10,
        ),
        pagingSourceFactory = { getArticleWithTextUseCase() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    private var _searchResults = MutableStateFlow(emptyList<ArticleItem>())
    val searchResults: StateFlow<List<ArticleItem>>
        get() = _searchResults

    fun search(query: String) {
        viewModelScope.launch(ioDispatcher) {
            _searchResults.value = pocketRepository.searchLocal(query)
        }
    }
    fun selectArticle(articleItem: ArticleItem) {
        _selectedArticle.value = articleItem
        provideSummary(articleItem.itemId)
    }
    private fun provideSummary(articleId: String) {
        viewModelScope.launch(ioDispatcher) {
            if (articleId.isEmpty()) {
                _selectedArticleSummary.value = PocketSummary(id = articleId, summary = "No Article Provided")
                return@launch
            }
            val article: PocketArticle? = pocketRepository.getArticleById(articleId)
            if (article != null) {
                _selectedArticleSummary.value = pocketDao.getSummary(articleId)
                    ?: supabaseService.getSummaryById(articleId).decodeAs()
                    ?: PocketSummary(id = articleId, summary = "No Summary Provided")
//                val summary: List<ArticleSummary> = modalClient.summarize(
//                   listOf( ModalArticle(id = articleId, text = article.text ?: "No Article Provided"))
//                ).getOrElse(emptyList())
//                _selectedArticleSummary.value = summary.getOrElse(0
//                ) { ArticleSummary(id = articleId, summary = "No Summary Provided") }
            }
        }
    }

}


sealed interface PocketUiState {
    data object Loading : PocketUiState
    data class Error(val throwable: Throwable) : PocketUiState
    data class Success(val data: List<String>) : PocketUiState

}
