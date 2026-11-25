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
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.LibraryStatus
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.screens.components.ErrorMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import timber.log.Timber
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val libraryStatus: LibraryStatus,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel(), Store<ArticleListState, ArticleListEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleListEvent>()
    override val event: SharedFlow<ArticleListEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _selectedTag = MutableStateFlow<String?>(null)
    private val _sortOption = MutableStateFlow(ArticleSortOption.Newest)
    private val _selectedArticle = MutableStateFlow<ArticleItem>(EMPTYARTICLEITEM)
    private val _selectedTab = MutableStateFlow(ArticleListTab.HOME)

    private data class TagList(val tags: List<String>, val load: TagsLoad)

    /** Each step up reads the tags again. */
    private val tagsRead = MutableStateFlow(0)

    private val tagsFlow = tagsRead
        .flatMapLatest {
            articleRepository.allTags()
                .map { TagList(it, TagsLoad.LOADED) }
                .onStart { emit(TagList(emptyList(), TagsLoad.LOADING)) }
                .catch { error ->
                    Timber.e(error, "Could not read the tags")
                    emit(TagList(emptyList(), TagsLoad.FAILED))
                }
        }
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5000),
            TagList(emptyList(), TagsLoad.LOADING),
        )

    private val databaseSyncFlow = articleRepository.isSyncing
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        combine(_selectedTag, _sortOption, tagsFlow) { tag, sort, tags ->
            Triple(tag, sort, tags)
        },
        combine(_selectedArticle, databaseSyncFlow, _selectedTab) { article, sync, tab ->
            Triple(article, sync, tab)
        },
        libraryStatus.state,
    ) { (selectedTag, sortOption, tagList), (selectedArticle, databaseSync, selectedTab), library ->
        ArticleListState(
            selectedTag = selectedTag,
            sortOption = sortOption,
            tags = tagList.tags,
            selectedArticle = selectedArticle,
            databaseSync = databaseSync,
            selectedTab = selectedTab,
            library = library,
            tagsLoad = tagList.load,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleListState()
    )

    override val state: StateFlow<ArticleListState> = _state

    init {
        viewModelScope.launch(ioDispatcher) {
            articleRepository.synchronize() //TODO: remove to activity
        }

        viewModelScope.launch {
            tagsFlow.collectLatest { tagList ->
                val currentTag = _selectedTag.value
                // A tag list that is still loading, or did not load, says nothing about the tag.
                if (tagList.load == TagsLoad.LOADED && currentTag != null && currentTag !in tagList.tags) {
                    _selectedTag.value = null
                }
            }
        }
    }

    val articles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(
            pageSize = 20,
        ),
        pagingSourceFactory = { articleRepository.pockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), loadingPage())

    val favoriteArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { articleRepository.favoritePockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), loadingPage())

    val archivedArticles: StateFlow<PagingData<ArticleItem>> = Pager(
        config = PagingConfig(pageSize = 20),
        pagingSourceFactory = { articleRepository.archivedPockets() }
    ).flow
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), loadingPage())

    val taggedArticles: StateFlow<PagingData<ArticleItem>> = _selectedTag
        .flatMapLatest { tag ->
            if (tag.isNullOrBlank()) {
                flowOf(loadingPage())
            } else {
                Pager(
                    config = PagingConfig(pageSize = 20),
                    pagingSourceFactory = { articleRepository.pocketsByTag(tag) }
                ).flow
            }
        }
        .cachedIn(viewModelScope)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), loadingPage())

    private var _searchResults = MutableStateFlow(emptyList<ArticleItem>())
    val searchResults: StateFlow<List<ArticleItem>>
        get() = _searchResults

    fun search(query: String) {
        viewModelScope.launch(ioDispatcher) {
            _searchResults.value = articleRepository.searchLocal(query)
        }
    }

    // Actions
    /** Brings the articles of a signed-in person back to an empty phone; the list calls it when it opens. */
    fun showLibrary() = libraryStatus.restoreIfEmpty()

    fun retryLibrary() = libraryStatus.retry()

    fun retryTags() = tagsRead.update { it + 1 }

    /** Runs one change; a failure is told, with a retry that runs the same change again. */
    private fun change(name: String, block: suspend () -> Unit) {
        viewModelScope.launch(ioDispatcher) {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "%s failed", name)
                _event.emit(ArticleListEvent.ShowError(ErrorMessage.CHANGE_FAILED) { change(name, block) })
            }
        }
    }

    fun setFavorite(itemId: String, isFavorite: Boolean) = change("setFavorite") {
        articleRepository.setFavorite(itemId, isFavorite)
    }

    fun setReadStatus(itemId: String, isRead: Boolean) = change("setReadStatus") {
        articleRepository.setReadStatus(itemId, isRead)
    }

    fun archiveArticle(itemId: String) = change("archiveArticle") {
        articleRepository.archive(itemId)
        _event.emit(ArticleListEvent.ShowSnackbar("Article archived"))
    }

    fun deleteArticle(itemId: String) = change("deleteArticle") {
        articleRepository.delete(itemId)
        _event.emit(ArticleListEvent.ShowSnackbar("Article deleted"))
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
            articleRepository.upsertArticle(article.copy(
                normalizedUrl = article.computeNormalizedUrl()
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
                    _event.emit(ArticleListEvent.ShowError(ErrorMessage.NO_LINK))
                    return@launch
                }

                if (url.toHttpUrlOrNull() == null) {
                    _event.emit(ArticleListEvent.ShowError(ErrorMessage.LINK_NOT_SUPPORTED))
                    return@launch
                }

                val timeNow = System.currentTimeMillis()
                val normalizedUrl = normalizeUrl(url)
                val articleId = articleRepository.saveNewArticle(
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
                val currentArticle = articleRepository.getArticleById(articleId)
                if (currentArticle?.deletedAt != null) {
                    Timber.d("Article %s was deleted during save, skipping metadata update", articleId)
                    return@launch
                }

                articleRepository.updateUnfurledDetails(
                    itemId = articleId,
                    title = resolvedTitle,
                    url = resolvedUrl,
                    image = resolvedImage,
                    hasImage = hasImage,
                    excerpt = resolvedExcerpt,
                    normalizedUrl = normalizeUrl(resolvedUrl),
                )

                // Back up immediately so the article's existence marker lands in
                // Firestore before the detail screen opens its archive listener.
                // The periodic background sync (syncToFirestore) is enqueued as a
                // safety backstop in case the inline backup fails (e.g. offline).
                articleRepository.backupArticleNow(articleId)
                    .onFailure { t -> Timber.w(t, "Inline backup failed for $articleId — periodic sync will retry") }
                articleRepository.syncToFirestore()
            } catch (e: CancellationException) {
                throw e
            } catch (error: Throwable) {
                Timber.e(error, "Failed to save shared article.")
                _event.emit(ArticleListEvent.ShowError(ErrorMessage.SAVE_FAILED) { saveUrl(givenUrl, givenTitle) })
            } finally {
                _isSaving.value = false
            }
        }
    }

    fun regenerateArticleDetails(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                // Get the current article
                val article = articleRepository.getArticleById(itemId)
                if (article == null) {
                    _event.emit(ArticleListEvent.ShowError(ErrorMessage.ARTICLE_MISSING))
                    return@launch
                }

                val url = article.url ?: article.givenUrl
                if (url.isNullOrBlank()) {
                    _event.emit(ArticleListEvent.ShowError(ErrorMessage.ARTICLE_HAS_NO_LINK))
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
                articleRepository.updateUnfurledDetails(
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
            } catch (e: CancellationException) {
                throw e
            } catch (error: Throwable) {
                Timber.e(error, "Failed to regenerate article details for: $itemId")
                _event.emit(
                    ArticleListEvent.ShowError(ErrorMessage.DETAILS_NOT_UPDATED) { regenerateArticleDetails(itemId) }
                )
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

    private companion object {
        /**
         * A page that still loads, as the value before the first load. `PagingData.empty()` without
         * load states reads as loaded and empty, so an empty notice would flash on each open.
         */
        fun loadingPage(): PagingData<ArticleItem> = PagingData.empty(
            sourceLoadStates = LoadStates(
                refresh = LoadState.Loading,
                prepend = LoadState.NotLoading(endOfPaginationReached = false),
                append = LoadState.NotLoading(endOfPaginationReached = false),
            ),
        )
    }
}
