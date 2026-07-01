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
// TODO: Re-enable ContentMetricsCalculator when a new text provider replaces Jina
// import com.jayteealao.trails.common.ContentMetricsCalculator
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import timber.log.Timber
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val getArticleWithTextUseCase: GetArticleWithTextUseCase,
    private val articleDao: ArticleDao,
    // TODO: Re-enable ContentMetricsCalculator when a new text provider replaces Jina
    // private val contentMetricsCalculator: ContentMetricsCalculator,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel(), Store<ArticleListState, ArticleListEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleListEvent>()
    override val event: SharedFlow<ArticleListEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _selectedTag = MutableStateFlow<String?>(null)
    private val _sortOption = MutableStateFlow(ArticleSortOption.Newest)
    private val _selectedArticle = MutableStateFlow<ArticleItem>(EMPTYARTICLEITEM)
    private val _selectedArticleSummary = MutableStateFlow(PocketSummary())
    private val _selectedTab = MutableStateFlow(ArticleListTab.HOME)

    private val tagsFlow = articleRepository.allTags()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val databaseSyncFlow = articleRepository.isSyncing
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        combine(_selectedTag, _sortOption, tagsFlow) { tag, sort, tags ->
            Triple(tag, sort, tags)
        },
        combine(_selectedArticle, _selectedArticleSummary, databaseSyncFlow, _selectedTab) { article, summary, sync, tab ->
            Quad(article, summary, sync, tab)
        }
    ) { (selectedTag, sortOption, tags), (selectedArticle, selectedArticleSummary, databaseSync, selectedTab) ->
        ArticleListState(
            selectedTag = selectedTag,
            sortOption = sortOption,
            tags = tags,
            selectedArticle = selectedArticle,
            selectedArticleSummary = selectedArticleSummary,
            databaseSync = databaseSync,
            selectedTab = selectedTab
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleListState()
    )

    private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

    override val state: StateFlow<ArticleListState> = _state

    init {
        viewModelScope.launch(ioDispatcher) {
            articleRepository.synchronize() //TODO: remove to activity
        }

        viewModelScope.launch {
            tagsFlow.collectLatest { availableTags ->
                val currentTag = _selectedTag.value
                if (currentTag != null && currentTag !in availableTags) {
                    _selectedTag.value = null
                }
            }
        }
    }

    fun sync() {
        viewModelScope.launch(ioDispatcher) {
//            articleDao.clearModalTable()
//            synchronizePocketUseCase()
        }
    }

    private var _articles = MutableStateFlow(emptyList<Article>())
    val articles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(
            pageSize = 20,
        ),
        pagingSourceFactory = { getArticleWithTextUseCase() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    val favoriteArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { articleRepository.favoritePockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PagingData.empty())

    val archivedArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { articleRepository.archivedPockets() }
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
                    pagingSourceFactory = { articleRepository.pocketsByTag(tag) }
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
            _searchResults.value = articleRepository.searchLocal(query)
        }
    }

    // Actions
    fun setFavorite(itemId: String, isFavorite: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.setFavorite(itemId, isFavorite)
            } catch (e: Exception) {
                _event.emit(ArticleListEvent.ShowError(e))
            }
        }
    }

    fun setReadStatus(itemId: String, isRead: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.setReadStatus(itemId, isRead)
            } catch (e: Exception) {
                _event.emit(ArticleListEvent.ShowError(e))
            }
        }
    }

    fun archiveArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.archive(itemId)
                _event.emit(ArticleListEvent.ShowSnackbar("Article archived"))
            } catch (e: Exception) {
                _event.emit(ArticleListEvent.ShowError(e))
            }
        }
    }

    fun deleteArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.delete(itemId)
                _event.emit(ArticleListEvent.ShowSnackbar("Article deleted"))
            } catch (e: Exception) {
                _event.emit(ArticleListEvent.ShowError(e))
            }
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

    fun setSelectedTab(tab: ArticleListTab) {
        _selectedTab.value = tab
    }

    fun shareArticle(title: String, url: String) {
        viewModelScope.launch {
            _event.emit(ArticleListEvent.ShareArticle(title, url))
        }
    }

    fun copyLink(url: String, label: String = "Article URL") {
        viewModelScope.launch {
            _event.emit(ArticleListEvent.CopyLink(url, label))
        }
    }

    fun insertArticle(article: Article) {
        viewModelScope.launch(ioDispatcher) {
            articleDao.upsertArticle(article.copy(
                normalizedUrl = normalizeUrl(article.url ?: article.givenUrl ?: "")
            ))
        }
    }

    private val _isSaving = MutableStateFlow(false)
    val isSaving: StateFlow<Boolean> = _isSaving.asStateFlow()

    private val _intentUrl = MutableStateFlow("")
    val intentUrl: StateFlow<String>
        get() = _intentUrl

    private val _intentTitle = MutableStateFlow("")
    val intentTitle: StateFlow<String>
        get() = _intentTitle

    private val _savedArticleId = MutableStateFlow<String?>(null)
    val savedArticleId: StateFlow<String?>
        get() = _savedArticleId

    val unfurler = Unfurler()

    fun saveUrl(givenUrl: Uri, givenTitle: String?) {
        // Reset state from any previous share
        _isSaving.value = true
        _savedArticleId.value = null

        val id = generateId()
        val (title, url) = if (givenTitle == null) {
            extractTitleAndUrl(givenUrl.toString()) ?: Pair(givenTitle, givenUrl.toString())
        } else {
            Pair(givenTitle, givenUrl.toString())
        }

        _intentUrl.value = url
        _intentTitle.value = title ?: ""

        viewModelScope.launch(ioDispatcher) {
            try {
                if (url.isBlank()) {
                    _event.emit(ArticleListEvent.ShowError(
                        IllegalArgumentException("No valid URL found in shared content")
                    ))
                    return@launch
                }

                if (url.toHttpUrlOrNull() == null) {
                    _event.emit(ArticleListEvent.ShowError(
                        IllegalArgumentException("Only HTTP and HTTPS URLs are supported")
                    ))
                    return@launch
                }

                val timeNow = System.currentTimeMillis()
                val normalizedUrl = normalizeUrl(url)
                val articleId = articleDao.upsertNewArticle(
                    Article(
                        itemId = id,
                        resolvedId = null,
                        title = "",
                        givenTitle = title ?: "",
                        url = url,
                        givenUrl = url,
                        normalizedUrl = normalizedUrl,
                        timeAdded = timeNow,
                        timeUpdated = timeNow,
                    )
                )

                val isNewArticle = (articleId == id)
                _savedArticleId.value = articleId

                if (!isNewArticle) {
                    _event.emit(ArticleListEvent.ShowSnackbar("Article already saved — details refreshed"))
                }

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
                    resolvedUrl = unfurlResult.url.toString()
                    resolvedImage = unfurlResult.thumbnail?.toString()
                    hasImage = unfurlResult.thumbnail != null
                    resolvedExcerpt = unfurlResult.description ?: ""
                }

                if (_intentTitle.value.isBlank()) {
                    _intentTitle.value = resolvedTitle
                }

                // Guard against undo race: skip update if article was deleted during unfurl
                val currentArticle = articleDao.getArticleById(articleId)
                if (currentArticle?.deletedAt != null) {
                    Timber.d("Article %s was deleted during save, skipping metadata update", articleId)
                    return@launch
                }

                articleDao.updateUnfurledDetails(
                    itemId = articleId,
                    title = resolvedTitle,
                    url = resolvedUrl,
                    image = resolvedImage,
                    hasImage = hasImage,
                    excerpt = resolvedExcerpt,
                    normalizedUrl = normalizeUrl(resolvedUrl),
                )

                // TODO: Replace with new text provider (archiver/singlefile) to extract
                // article markdown text, then re-enable ContentMetricsCalculator to
                // compute reading time, listening time, and word count.

                // Back up immediately so the article's existence marker lands in
                // Firestore before the detail screen opens its archive listener.
                // The periodic background sync (syncToFirestore) is enqueued as a
                // safety backstop in case the inline backup fails (e.g. offline).
                articleRepository.backupArticleNow(articleId)
                    .onFailure { t -> Timber.w(t, "Inline backup failed for $articleId — periodic sync will retry") }
                articleRepository.syncToFirestore()
            } catch (error: Throwable) {
                Timber.e(error, "Failed to save shared article.")
                _event.emit(ArticleListEvent.ShowError(error))
            } finally {
                _isSaving.value = false
            }
        }
    }

    fun regenerateArticleDetails(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                // Get the current article
                val article = articleDao.getArticleById(itemId)
                if (article == null) {
                    _event.emit(ArticleListEvent.ShowError(Exception("Article not found")))
                    return@launch
                }

                val url = article.url ?: article.givenUrl
                if (url.isNullOrBlank()) {
                    _event.emit(ArticleListEvent.ShowError(Exception("No URL found for article")))
                    return@launch
                }

                // Refetch metadata using unfurler
                val unfurlResult = runCatching { unfurler.unfurl(url) }
                    .onFailure { Timber.w(it, "Failed to unfurl url: %s", url) }
                    .getOrNull()

                var resolvedTitle = article.givenTitle
                var resolvedUrl = url
                var resolvedImage: String? = null
                var hasImage = false
                var resolvedExcerpt = ""

                if (unfurlResult != null) {
                    resolvedTitle = unfurlResult.title ?: resolvedTitle
                    resolvedUrl = unfurlResult.url.toString()
                    resolvedImage = unfurlResult.thumbnail?.toString()
                    hasImage = unfurlResult.thumbnail != null
                    resolvedExcerpt = unfurlResult.description ?: ""
                }

                // Update article with new metadata
                articleDao.updateUnfurledDetails(
                    itemId = itemId,
                    title = resolvedTitle,
                    url = resolvedUrl,
                    image = resolvedImage,
                    hasImage = hasImage,
                    excerpt = resolvedExcerpt,
                    normalizedUrl = normalizeUrl(resolvedUrl),
                )

                // TODO: Re-enable text extraction and metrics when new text provider is available

                Timber.d("Successfully regenerated details for article: $itemId")
                _event.emit(ArticleListEvent.ShowToast("Article details updated"))
            } catch (error: Throwable) {
                Timber.e(error, "Failed to regenerate article details for: $itemId")
                _event.emit(ArticleListEvent.ShowError(error))
            }
        }
    }

    fun extractTitleAndUrl(combinedString: String): Pair<String, String>? {
        val urlRegex = "(https?://\\S+)".toRegex()
        val urlMatch = urlRegex.find(combinedString)

        return if (urlMatch != null) {
            val url = urlMatch.value.trimEnd('.', ',', ')', ']', ';', ':', '!')
            val title = combinedString.substringBefore(urlMatch.value).trim()
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
