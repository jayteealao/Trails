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

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.common.generateDeterministicNanoId
import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.screens.articleList.PocketUiState.Loading
import com.jayteealao.trails.services.supabase.SupabaseService
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
//    private val synchronizePocketUseCase: SynchronizePocketUseCase,
    private val getArticleWithTextUseCase: GetArticleWithTextUseCase,
    private val supabaseService: SupabaseService,
    private val pocketDao: PocketDao,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel() {

    init {
        Timber.d(generateDeterministicNanoId("my_input"))
        Timber.d(generateDeterministicNanoId("my_input"))
        viewModelScope.launch(ioDispatcher) {
//            supabaseService.observeChanges {
//                Timber.d("Supabase changes: $it")
//            }
            pocketRepository.synchronize()
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
//            synchronizePocketUseCase()
        }
    }

    val test = MutableStateFlow("")

    private var _articles = MutableStateFlow(emptyList<PocketArticle>())
    val articles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(
            pageSize = 20,
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
//        provideSummary(articleItem.itemId)
    }

    fun insertArticle(article: PocketArticle) {
        viewModelScope.launch(ioDispatcher) {
            pocketDao.insertPocket(article)
        }
    }

    fun saveUrl(givenUrl: Uri, givenTitle: String?) {
        val unfurler = Unfurler()
        viewModelScope.launch(ioDispatcher) {

            val result = unfurler.unfurl(givenUrl.toString())
            val article = PocketArticle(
                itemId = generateId(),
                resolvedId = null,
                title = result?.title ?: givenTitle ?: "",
                givenTitle = givenTitle ?: "",
                url = (result?.url ?: givenUrl.toString()).toString(),
                givenUrl = givenUrl.toString(),
                favorite = "0",
                status = "", //check acceptable values
                image = if (result?.thumbnail == null) null else result.thumbnail.toString(),
                hasImage = result?.thumbnail != null,
                hasVideo = false,
                hasAudio = false,
                listenDurationEstimate = 0,
                wordCount = 0,
                wordCountMessage = null,
                sortId = 0,
                excerpt = result?.description ?: "",
                timeAdded = System.currentTimeMillis(),
                timeUpdated = System.currentTimeMillis(),
                timeRead = 0,
                timeFavorited = 0,
                timeToRead = 0,
            )
            insertArticle(article)
        }

    }

}


sealed interface PocketUiState {
    data object Loading : PocketUiState
    data class Error(val throwable: Throwable) : PocketUiState
    data class Success(val data: List<String>) : PocketUiState

}
