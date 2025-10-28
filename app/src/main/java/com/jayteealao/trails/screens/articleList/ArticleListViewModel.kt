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
import com.jayteealao.trails.services.jina.JinaClient
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    private val getArticleWithTextUseCase: GetArticleWithTextUseCase,
    private val pocketDao: PocketDao,
    private val jinaClient: JinaClient,
    private val contentMetricsCalculator: ContentMetricsCalculator,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel() {

    private val _selectedTag = MutableStateFlow<String?>(null)
    val selectedTag: StateFlow<String?> = _selectedTag

    private val _sortOption = MutableStateFlow(ArticleSortOption.Newest)
    val sortOption: StateFlow<ArticleSortOption> = _sortOption

    // Read filter state
    enum class ReadFilter { ALL, READ_ONLY, UNREAD_ONLY }

    private val _readFilterState = MutableStateFlow(ReadFilter.ALL)
    val readFilterState: StateFlow<ReadFilter> = _readFilterState

    // Bulk selection state
    private val _bulkSelectionMode = MutableStateFlow(false)
    val bulkSelectionMode: StateFlow<Boolean> = _bulkSelectionMode

    private val _selectedArticleIds = MutableStateFlow<Set<String>>(emptySet())
    val selectedArticleIds: StateFlow<Set<String>> = _selectedArticleIds

    // Search state
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery

    private val tagsFlow = pocketRepository.allTags()
    val tags = tagsFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.synchronize() //TODO: remove to activity
        }

        viewModelScope.launch {
            tags.collectLatest { availableTags ->
                val currentTag = _selectedTag.value
                if (currentTag != null && currentTag !in availableTags) {
                    _selectedTag.value = null
                }
            }
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
    val articles: StateFlow<PagingData<ArticleItem>> = _sortOption
        .flatMapLatest { sortOption ->
            Pager(
                config = PagingConfig(
                    pageSize = 20,
                ),
                pagingSourceFactory = {
                    // For Newest: ORDER BY time_added DESC
                    // For Oldest: ORDER BY time_added ASC
                    getArticleWithTextUseCase(sortOption)
                }
            ).flow
        }
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    val favoriteArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { pocketRepository.favoritePockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    val archivedArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { pocketRepository.archivedPockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    val taggedArticles: StateFlow<PagingData<ArticleItem>> = _selectedTag
        .flatMapLatest { tag ->
            if (tag.isNullOrBlank()) {
                flowOf(PagingData.empty())
            } else {
                Pager(
                    config = PagingConfig(pageSize = 20),
                    pagingSourceFactory = { pocketRepository.pocketsByTag(tag) }
                ).flow
            }
        }
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

    fun setFavorite(itemId: String, isFavorite: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.setFavorite(itemId, isFavorite)
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

    fun archiveArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.archive(itemId)
        }
    }

    fun deleteArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            pocketRepository.delete(itemId)
        }
    }

    fun selectArticle(articleItem: ArticleItem) {
        _selectedArticle.value = articleItem
//        provideSummary(articleItem.itemId)
    }

    fun selectTag(tag: String?) {
        _selectedTag.value = tag
    }

    fun setSortOption(option: ArticleSortOption) {
        if (_sortOption.value != option) {
            _sortOption.value = option
        }
    }

    fun setReadFilter(filter: ReadFilter) {
        _readFilterState.value = filter
    }

    fun toggleBulkSelectionMode() {
        _bulkSelectionMode.value = !_bulkSelectionMode.value
        if (!_bulkSelectionMode.value) {
            // Exit bulk mode, clear selection
            _selectedArticleIds.value = emptySet()
        }
    }

    fun toggleArticleSelection(articleId: String) {
        _selectedArticleIds.value = if (_selectedArticleIds.value.contains(articleId)) {
            _selectedArticleIds.value - articleId
        } else {
            _selectedArticleIds.value + articleId
        }
    }

    fun clearSelection() {
        _selectedArticleIds.value = emptySet()
    }

    fun setSearchQuery(query: String) {
        _searchQuery.value = query
    }

    fun bulkArchive(articleIds: Set<String>) {
        viewModelScope.launch(ioDispatcher) {
            articleIds.forEach { itemId ->
                pocketRepository.archive(itemId)
            }
            clearSelection()
            toggleBulkSelectionMode()
        }
    }

    fun bulkDelete(articleIds: Set<String>) {
        viewModelScope.launch(ioDispatcher) {
            articleIds.forEach { itemId ->
                pocketRepository.delete(itemId)
            }
            clearSelection()
            toggleBulkSelectionMode()
        }
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
//        Timber.d("id: $id")
//        Timber.d("givenUrl in saveUrl: $givenUrl")
//        Timber.d("givenTitle: $givenTitle")
        val (title, url) = if (givenTitle == null) {
            extractTitleAndUrl(givenUrl.toString()) ?: Pair(givenTitle, givenUrl.toString()) // Handle parsing failure
        } else {
            Pair(givenTitle, givenUrl.toString())
        }

        _intentUrl.value = url
        _intentTitle.value = title ?: ""

        viewModelScope.launch(ioDispatcher) {
            val timeNow = System.currentTimeMillis()
            if (url.isBlank()) {
                shouldShow.value = false
                return@launch
            }

            var articleId = id
            try {
                articleId = pocketDao.upsertArticle(
                    PocketArticle(
                        itemId = id,
                        resolvedId = null,
                        title = "",
                        givenTitle = title ?: "",
                        url = url,
                        givenUrl = url,
                        timeAdded = timeNow,
                        timeUpdated = timeNow,
                    )
                )

                var resolvedTitle = title ?: ""
                var resolvedUrl = url
                var resolvedImage: String? = null
                var hasImage = false
                var resolvedExcerpt = ""

                val unfurlResult = runCatching { unfurler.unfurl(url) }
                    .onFailure { Timber.w(it, "Failed to unfurl url: %s", url) }
                    .getOrNull()

                if (unfurlResult != null) {
                    resolvedTitle = unfurlResult.title ?: resolvedTitle
                    resolvedUrl = (unfurlResult.url ?: resolvedUrl).toString()
                    resolvedImage = unfurlResult.thumbnail?.toString()
                    hasImage = unfurlResult.thumbnail != null
                    resolvedExcerpt = unfurlResult.description ?: ""
                }

                if (_intentTitle.value.isBlank()) {
                    _intentTitle.value = resolvedTitle
                }

                pocketDao.updateUnfurledDetails(
                    itemId = articleId,
                    title = resolvedTitle,
                    url = resolvedUrl,
                    image = resolvedImage,
                    hasImage = hasImage,
                    excerpt = resolvedExcerpt,
                )

                val jinaResult = runCatching { jinaClient.getReader(url) }
                    .onFailure { Timber.w(it, "Failed to fetch reader content for %s", url) }
                    .getOrNull()

                val readerContent = jinaResult?.data?.content //TODO: replace jina with call to archiver/singlefile,
                if (!readerContent.isNullOrBlank()) {
                    pocketDao.updateText(articleId, readerContent)
                    val metrics = contentMetricsCalculator.calculateMetrics(readerContent)
                    pocketDao.updateArticleMetrics(
                        articleId,
                        metrics.readingTimeMinutes,
                        metrics.listeningTimeMinutes,
                        metrics.wordCount,
                    )
                }
            } catch (error: Throwable) {
                Timber.e(error, "Failed to save shared article.")
            } finally {
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
