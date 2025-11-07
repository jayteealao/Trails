package com.jayteealao.trails.screens.articleSearch

import com.jayteealao.trails.data.models.ArticleItem

/**
 * Consolidated UI state for ArticleSearchScreen
 */
data class ArticleSearchState(
    val searchResultsLocal: List<ArticleItem> = emptyList(),
    val searchResultsHybrid: List<ArticleItem> = emptyList(),
    val isSearching: Boolean = false,
    val availableTags: List<String> = emptyList()
) {
    /**
     * Combined deduplicated search results (hybrid + local)
     */
    val combinedResults: List<ArticleItem>
        get() = linkedSetOf(searchResultsHybrid, searchResultsLocal).flatten()
}

/**
 * One-time events for ArticleSearchScreen
 */
sealed interface ArticleSearchEvent {
    data class NavigateToArticle(val itemId: String) : ArticleSearchEvent
    data class ShowToast(val message: String) : ArticleSearchEvent
    data class ShowError(val error: Throwable) : ArticleSearchEvent
}
