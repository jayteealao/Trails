package com.jayteealao.trails.screens.tagManagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.TagSuggestionUiState
import com.jayteealao.trails.services.gemini.GeminiClient
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class TagManagementViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val articleDao: ArticleDao,
    private val geminiClient: GeminiClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
) : ViewModel(), Store<TagManagementState, TagManagementEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<TagManagementEvent>()
    override val event: SharedFlow<TagManagementEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _tagSuggestions = MutableStateFlow<Map<String, TagSuggestionUiState>>(emptyMap())
    private val _article = MutableStateFlow<ArticleItem?>(null)

    private val tagsFlow = articleRepository.allTags()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        tagsFlow,
        _tagSuggestions,
        _article
    ) { tags, tagSuggestions, article ->
        TagManagementState(
            tags = tags,
            tagSuggestionStates = tagSuggestions,
            article = article
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = TagManagementState()
    )

    override val state: StateFlow<TagManagementState> = _state

    /**
     * Fetches an article by ID from the database.
     */
    fun getArticle(articleId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                val articles = articleDao.getArticlesByIds(listOf(articleId))
                _article.value = articles.firstOrNull()
            } catch (e: Exception) {
                Timber.e(e, "Failed to fetch article: $articleId")
                _event.emit(TagManagementEvent.ShowError(e))
            }
        }
    }

    /**
     * Updates a tag for an article (add or remove).
     */
    fun updateTag(itemId: String, tag: String, enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            try {
                if (enabled) {
                    articleRepository.addTag(itemId, tag)
                } else {
                    articleRepository.removeTag(itemId, tag)
                }
            } catch (e: Exception) {
                _event.emit(TagManagementEvent.ShowError(e))
            }
        }
    }

    /**
     * Requests tag suggestions for an article.
     * Two-phase approach:
     * 1. If article has no excerpt/summary, fetch one using URL context first
     * 2. Then fetch tag suggestions using the structured JSON API with cached summary
     */
    fun requestTagSuggestions(articleItem: ArticleItem) {
        val signature = buildTagSuggestionSignature(articleItem)
        val existing = _tagSuggestions.value[articleItem.itemId]
        val hasValidSuggestions = existing?.errorMessage == null && existing?.tags?.isNotEmpty() == true
        if (existing?.isLoading == true) return
        if (hasValidSuggestions && existing?.requestSignature == signature) return

        _tagSuggestions.update { current ->
            val snapshot = existing ?: current[articleItem.itemId] ?: TagSuggestionUiState()
            current + (articleItem.itemId to snapshot.copy(
                isLoading = true,
                errorMessage = null,
                requestSignature = signature
            ))
        }

        viewModelScope.launch(ioDispatcher) {
            // Phase 1: Ensure we have a summary
            var summary = articleItem.snippet
            if (summary.isNullOrBlank() && !articleItem.url.isNullOrBlank()) {
                Timber.d("requestTagSuggestions: No excerpt found, fetching summary first for ${articleItem.itemId}")

                val summaryResult = geminiClient.fetchArticleSummary(
                    GeminiClient.ArticleSummaryRequest(
                        articleId = articleItem.itemId,
                        title = articleItem.title,
                        url = articleItem.url
                    )
                )

                when (summaryResult) {
                    is GeminiClient.ArticleSummaryResult.Success -> {
                        summary = summaryResult.summary
                        Timber.d("requestTagSuggestions: Summary generated, saving to DB")
                        // Save summary to database
                        articleRepository.updateExcerpt(articleItem.itemId, summary)
                    }
                    is GeminiClient.ArticleSummaryResult.Error -> {
                        Timber.e("requestTagSuggestions: Failed to fetch summary: ${summaryResult.message}")
                        _tagSuggestions.update { current ->
                            val baseline = current[articleItem.itemId] ?: TagSuggestionUiState()
                            current + (articleItem.itemId to baseline.copy(
                                isLoading = false,
                                errorMessage = "Failed to fetch article summary: ${summaryResult.message}",
                                requestSignature = signature
                            ))
                        }
                        return@launch
                    }
                }
            }

            // Phase 2: Fetch tag suggestions using structured JSON (no URL context)
            Timber.d("requestTagSuggestions: Fetching tag suggestions with summary")
            val result = geminiClient.fetchTagSuggestions(
                GeminiClient.TagSuggestionRequest(
                    articleId = articleItem.itemId,
                    title = articleItem.title,
                    description = summary,
                    url = null,  // Don't use URL context for tag suggestions
                    availableTags = tagsFlow.value
                )
            )

            _tagSuggestions.update { current ->
                val baseline = current[articleItem.itemId] ?: TagSuggestionUiState()
                val updated = when (result) {
                    is GeminiClient.TagSuggestionResult.Success -> baseline.copy(
                        isLoading = false,
                        tags = result.tags,
                        errorMessage = null,
                        requestSignature = signature
                    )
                    is GeminiClient.TagSuggestionResult.Error -> baseline.copy(
                        isLoading = false,
                        errorMessage = result.message,
                        requestSignature = signature
                    )
                }
                current + (articleItem.itemId to updated)
            }
        }
    }

    /**
     * Clears any error message for tag suggestions on a specific article.
     */
    fun clearTagSuggestionError(articleId: String) {
        _tagSuggestions.update { current ->
            val existing = current[articleId] ?: return@update current
            if (existing.errorMessage == null) return@update current
            current + (articleId to existing.copy(errorMessage = null))
        }
    }

    /**
     * Builds a signature for tag suggestion requests to detect when we need to refresh.
     */
    private fun buildTagSuggestionSignature(articleItem: ArticleItem): String {
        return listOf(
            articleItem.title,
            articleItem.snippet.orEmpty(),
            articleItem.url
        ).joinToString(separator = "|") { it.trim() }
    }
}

/**
 * State for TagManagementScreen
 */
data class TagManagementState(
    val tags: List<String> = emptyList(),
    val tagSuggestionStates: Map<String, TagSuggestionUiState> = emptyMap(),
    val article: ArticleItem? = null
)

/**
 * One-time events for TagManagementScreen
 */
sealed interface TagManagementEvent {
    data class ShowError(val error: Throwable) : TagManagementEvent
}
