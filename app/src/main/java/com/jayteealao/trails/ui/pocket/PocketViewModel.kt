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

package com.jayteealao.trails.ui.pocket

import android.graphics.Bitmap
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.room.Update
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import com.jayteealao.trails.data.PocketRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketTuple
import com.jayteealao.trails.network.ArticleExtractor
import com.jayteealao.trails.sync.SyncStatusMonitor
import com.jayteealao.trails.ui.pocket.PocketUiState.Loading
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import com.jayteealao.trails.usecases.SynchronizePocketUseCase
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import timber.log.Timber
import java.net.URL
import java.nio.charset.Charset
import javax.inject.Inject

@HiltViewModel
class PocketViewModel @Inject constructor(
    private val pocketRepository: PocketRepository,
    private val synchronizePocketUseCase: SynchronizePocketUseCase,
    private val getArticleWithTextUseCase: GetArticleWithTextUseCase,
    val articleExtractor: ArticleExtractor,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel() {

    private val _uiState = MutableStateFlow<PocketUiState>(Loading)
    val uiState: StateFlow<PocketUiState>
        get() = _uiState

//    TODO: move to usecase
    val databaseSync = pocketRepository.isSyncing
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun sync() {
        viewModelScope.launch(ioDispatcher) {
            synchronizePocketUseCase()
        }
    }

    val test = MutableStateFlow("")

    private var _articles = MutableStateFlow(emptyList<PocketArticle>())
    val articles: StateFlow<PagingData<PocketTuple>> = Pager(
        config = PagingConfig(
            pageSize = 20,
        ),
        pagingSourceFactory = { getArticleWithTextUseCase() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    private var _searchResults = MutableStateFlow(emptyList<PocketTuple>())
    val searchResults: StateFlow<List<PocketTuple>>
        get() = _searchResults

    fun search(query: String) {
        viewModelScope.launch(ioDispatcher) {
            _searchResults.value = pocketRepository.search(query)
        }
    }

    inner class MyWebViewClient : WebViewClient() {
        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            Timber.d("onPageStarted: $url")
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            Timber.d("onPageFinished: $url")
            // Extract the HTML content
//            view?.evaluateJavascript("document.documentElement.outerHTML.toString()") { html ->
//                viewModelScope.launch {
//                    Timber.d("onPageFinished: $html")
//                     Remove the surrounding quotes
//                    val htmlString = String(html.substring(1, html.length - 1).encodeToByteArray(), Charset.defaultCharset())
//                    Timber.d("onPageFinished encoded: $htmlString")
//
//                     Extract the article text
//                    val articleText = articleExtractor.extractFromHtml(URL(url), htmlString)
//
//                     Update the UI
//                    test.value =  articleText ?: "not loaded"
//                }
//            }
            view?.evaluateJavascript("javascript:window.document.getElementsByTagName('html')[0].innerHTML") { html ->
                viewModelScope.launch { // html variable contains the extracted HTML content

                    // You can use it as per your requirement
                    Timber.d("onPageFinished: $html")
                    // Remove the surrounding quotes
                    val htmlString = String(
                        html.substring(1, html.length - 1).encodeToByteArray(),
                        Charset.defaultCharset()
                    )
                    Timber.d("onPageFinished encoded: $htmlString")

                    // Extract the article text
                    val articleText = articleExtractor.extractFromHtml(URL(url), htmlString)

                    // Update the UI
                    test.value = articleText ?: "not loaded"
                }
            }
//
//            view?.evaluateJavascript("(function() { return document.documentElement.outerHTML; })();") {
//                // Handle extracted HTML content
//                val html = it?.removeSurrounding("\"") // Remove quotes from extracted HTML
//                Timber.d("HTML: $html")
//            }
        }
    }
}


sealed interface PocketUiState {
    object Loading : PocketUiState
    data class Error(val throwable: Throwable) : PocketUiState
    data class Success(val data: List<String>) : PocketUiState
}
