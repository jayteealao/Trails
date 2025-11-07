package com.jayteealao.trails.screens.articleDetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.Article
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleDetailViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val sharedPreferencesManager: SharedPreferencesManager,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<ArticleDetailState, ArticleDetailEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleDetailEvent>()
    override val event: SharedFlow<ArticleDetailEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _article = MutableStateFlow<Article?>(null)
    private val _selectedTabIndex = MutableStateFlow(1)
    private val _jinaToken = MutableStateFlow("")
    private val _isLoading = MutableStateFlow(false)

    private val useFreediumFlow = sharedPreferencesManager.preferenceChangesFlow()
        .filter { it == "USE_FREEDIUM" }
        .map {
            Timber.d("Preference changed: $it")
            sharedPreferencesManager.getBoolean(it!!)
        }.stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean("USE_FREEDIUM")
        )

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        _article,
        _selectedTabIndex,
        _jinaToken,
        useFreediumFlow,
        _isLoading
    ) { article, selectedTab, jinaToken, useFreedium, isLoading ->
        ArticleDetailState(
            article = article,
            selectedTabIndex = selectedTab,
            jinaToken = jinaToken,
            jinaPlaceholder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here",
            useFreedium = useFreedium,
            isLoading = isLoading
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleDetailState(
            useFreedium = sharedPreferencesManager.getBoolean("USE_FREEDIUM"),
            jinaPlaceholder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here"
        )
    )

    override val state: StateFlow<ArticleDetailState> = _state

    // Actions
    fun getArticle(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            _isLoading.value = true
            try {
                val modifier = UrlModifier()
                var articleFetched = articleRepository.getArticleById(itemId)
                if (useFreediumFlow.value && articleFetched != null) {
                    articleFetched = articleFetched.copy(
                        url = modifier.modifyUrl(articleFetched.url ?: articleFetched.givenUrl!!)
                    )
                }
                _article.value = articleFetched
            } catch (e: Exception) {
                _event.emit(ArticleDetailEvent.ShowError(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun setSelectedTab(index: Int) {
        _selectedTabIndex.value = index
    }

    fun updateJinaToken(token: String) {
        _jinaToken.value = token
    }

    fun markAsRead(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.setReadStatus(itemId, true)
                _event.emit(ArticleDetailEvent.ArticleMarkedAsRead(itemId))
            } catch (e: Exception) {
                _event.emit(ArticleDetailEvent.ShowError(e))
            }
        }
    }
}