package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.local.database.Article

/**
 * Consolidated UI state for ArticleDetailScreen
 */
data class ArticleDetailState(
    val article: Article? = null,
    val selectedTabIndex: Int = 1, // Default to Web view (tab 1)
    val jinaToken: String = "",
    val jinaPlaceholder: String = "Insert Jina Token Here",
    val useFreedium: Boolean = false,
    val isLoading: Boolean = false
)

/**
 * One-time events for ArticleDetailScreen
 */
sealed interface ArticleDetailEvent {
    data class ShowToast(val message: String) : ArticleDetailEvent
    data class ArticleMarkedAsRead(val itemId: String) : ArticleDetailEvent
    data class NavigateBack : ArticleDetailEvent
    data class ShowError(val error: Throwable) : ArticleDetailEvent
}
