package com.jayteealao.trails.screens.articleSearch

import com.jayteealao.trails.data.models.ArticleItem

/**
 * Consolidated UI state for ArticleSearchScreen
 */
data class ArticleSearchState(
    /** The newest search's results, best first. */
    val searchResults: List<ArticleItem> = emptyList(),
    val isSearching: Boolean = false,
    val tags: List<String> = emptyList()
)

/**
 * One-time events for ArticleSearchScreen
 */
sealed interface ArticleSearchEvent {
    data class NavigateToArticle(val itemId: String) : ArticleSearchEvent
    data class ShowToast(val message: String) : ArticleSearchEvent
    data class ShowError(val error: Throwable) : ArticleSearchEvent
    data class ShareArticle(val title: String, val url: String) : ArticleSearchEvent
    data class CopyLink(val url: String, val label: String) : ArticleSearchEvent
}
