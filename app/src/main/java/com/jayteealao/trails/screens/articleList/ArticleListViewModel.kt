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
import com.jayteealao.trails.common.ContentMetricsCalculator
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.services.archivebox.ArchiveBoxClient
import com.jayteealao.trails.services.jina.JinaClient
import com.jayteealao.trails.services.supabase.SupabaseService
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.async
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
    private val jinaClient: JinaClient,
    private val contentMetricsCalculator: ContentMetricsCalculator,
    private val archiveBoxClient: ArchiveBoxClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel() {

    init {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.synchronize() //TODO: remove to activity
        }
    }

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

    var shouldShow: MutableStateFlow<Boolean> = MutableStateFlow(true)

    private val _intentUrl = MutableStateFlow("")
    val intentUrl: StateFlow<String>
        get() = _intentUrl

    private val _intentTitle = MutableStateFlow("")
    val intentTitle: StateFlow<String>
        get() = _intentTitle

    val unfurler = Unfurler()

    fun saveUrl(givenUrl: Uri, givenTitle: String?) {
        var id = generateId()
        var articleExists = false
        Timber.d("id: $id")
        Timber.d("givenUrl in saveUrl: $givenUrl")
        Timber.d("givenTitle: $givenTitle")
        val (title, url) = if (givenTitle == null) {
            extractTitleAndUrl(givenUrl.toString()) ?: Pair(givenTitle, givenUrl.toString()) // Handle parsing failure
        } else {
            Pair(givenTitle, givenUrl.toString())
        }
//        Timber.d("title: $title, url: $url")

        viewModelScope.launch(ioDispatcher) {
            val timeNow = System.currentTimeMillis()
            Timber.d("timeNow: $timeNow")
            if (url.isNotBlank()) {
                Timber.d("url is not blank")
                Timber.d("upserting article: $url")
                val newId = pocketDao.upsertArticle(
                    PocketArticle(
                        itemId = id,
                        resolvedId = null,
                        title = "",
                        givenTitle = title ?: "",
                        url = null,
                        givenUrl = url,
                        timeAdded = timeNow,
                        timeUpdated = timeNow,
                    )
                )
                Timber.d("article should have been upserted here")
                if (newId != id) {
                    articleExists = true
                    shouldShow.value = true // TODO: watch out for this: there be dragons
                    id = newId
                }
            }
        }

        _intentUrl.value = url
        _intentTitle.value = title.toString()

        viewModelScope.launch(ioDispatcher) {

            val unfurlJob = async { unfurler.unfurl(url) }
            val jinaJob = async { jinaClient.getReader(url) }

            val unfurlResult = unfurlJob.await()

            if (_intentTitle.value.isBlank()) {
                _intentTitle.value = unfurlResult?.title ?: title ?: ""
            }
//            jinaResult as ReaderResponse?
            pocketDao.updateUnfurledDetails(
                itemId = id,
                title = unfurlResult?.title ?: title ?: "",
                url = (unfurlResult?.url ?: url).toString(),
                image = if (unfurlResult?.thumbnail == null) null else unfurlResult.thumbnail.toString(),
                hasImage = unfurlResult?.thumbnail != null,
                excerpt = unfurlResult?.description ?: "",
            )
            val jinaResult = jinaJob.await()

            if (!jinaResult?.data?.content.isNullOrBlank()) {
                if (jinaResult != null) {
                    pocketDao.updateText(id, jinaResult.data.content)
                }
                shouldShow.value = false
                val metrics = contentMetricsCalculator.calculateMetrics(jinaResult?.data?.content ?: "")
                pocketDao.updateArticleMetrics(id, metrics.readingTimeMinutes, metrics.listeningTimeMinutes, metrics.wordCount)
            } else {
                shouldShow.value = false
            }
        }
    }

    fun extractTitleAndUrl(combinedString: String): Pair<String, String>? {
        val urlRegex = "(https?://\\S+)".toRegex()
        val urlMatch = urlRegex.find(combinedString)

        return if (urlMatch != null) {
            val url = urlMatch.value
            val title = combinedString.substringBefore(url).trim()
            Pair(title, url)
        } else {
            null
        }
    }

}


sealed interface PocketUiState {
    data object Loading : PocketUiState
    data class Error(val throwable: Throwable) : PocketUiState
    data class Success(val data: List<String>) : PocketUiState

}
