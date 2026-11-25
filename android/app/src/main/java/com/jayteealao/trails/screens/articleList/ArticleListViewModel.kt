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
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.LibraryStatus
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleAction
import com.jayteealao.trails.screens.articleList.actions.ArticleActionEvent
import com.jayteealao.trails.screens.articleList.actions.ArticleActionRunner
import com.jayteealao.trails.screens.articleList.actions.ArticleChange
import com.jayteealao.trails.screens.articleList.actions.refreshArticleDetails
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
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Provider

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class ArticleListViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val libraryStatus: LibraryStatus,
    private val unfurlers: Provider<Unfurler>,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel(), Store<ArticleListState, ArticleListEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleListEvent>()
    override val event: SharedFlow<ArticleListEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _selectedTag = MutableStateFlow<String?>(null)
    private val _sortOption = MutableStateFlow(ArticleSortOption.Newest)
    private val _selectedTab = MutableStateFlow(ArticleListTab.HOME)

    private val actions = ArticleActionRunner(
        repository = articleRepository,
        scope = viewModelScope,
        dispatcher = ioDispatcher,
        refreshDetails = { refreshArticleDetails(articleRepository, unfurlers.get(), it) },
        emit = { _event.emit(it.toListEvent()) },
    )

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
        combine(actions.sheet, databaseSyncFlow, _selectedTab) { sheet, sync, tab ->
            Triple(sheet, sync, tab)
        },
        libraryStatus.state,
    ) { (selectedTag, sortOption, tagList), (actionSheet, databaseSync, selectedTab), library ->
        ArticleListState(
            selectedTag = selectedTag,
            sortOption = sortOption,
            tags = tagList.tags,
            actionSheet = actionSheet,
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

    /** Runs [action] of [article], which is the article as its row shows it. */
    fun runAction(action: ArticleAction, article: ArticleItem) = actions.run(action, article)

    fun openActions(article: ArticleItem) = actions.openSheet(article)

    fun chooseAction(action: ArticleAction) = actions.choose(action)

    fun closeActions() = actions.closeSheet()

    fun setFavorite(itemId: String, isFavorite: Boolean) =
        actions.save(ArticleChange.Favourite(itemId, isFavorite))

    fun setReadStatus(itemId: String, isRead: Boolean) = actions.save(ArticleChange.Read(itemId, isRead))

    fun archiveArticle(itemId: String) = actions.save(ArticleChange.Archive(itemId))

    fun deleteArticle(itemId: String) = actions.save(ArticleChange.Delete(itemId))

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

    fun regenerateArticleDetails(itemId: String) = actions.regenerate(itemId)

    private companion object {
        fun ArticleActionEvent.toListEvent(): ArticleListEvent = when (this) {
            is ArticleActionEvent.Say -> ArticleListEvent.ShowSnackbar(message)
            is ArticleActionEvent.Failed -> ArticleListEvent.ShowError(message, retry)
            is ArticleActionEvent.Deleted -> ArticleListEvent.ArticleDeleted(undo)
            is ArticleActionEvent.Share -> ArticleListEvent.ShareArticle(title, url)
            is ArticleActionEvent.Copy -> ArticleListEvent.CopyLink(url)
            is ArticleActionEvent.Open -> ArticleListEvent.OpenInBrowser(url)
        }

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
