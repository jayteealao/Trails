package com.jayteealao.trails.screens.articleSearch

import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleSheet
import com.jayteealao.trails.screens.components.ErrorMessage

/**
 * Consolidated UI state for ArticleSearchScreen
 */
data class ArticleSearchState(
    /** The newest search's results, best first. */
    val searchResults: List<ArticleItem> = emptyList(),
    val isSearching: Boolean = false,
    /** The words of the newest search, or null when nothing was searched. */
    val searchedQuery: String? = null,
    /**
     * The newest search found no article. False when it found some that were deleted since, so
     * the deleted rows do not read as a search that matched nothing.
     */
    val foundNothing: Boolean = false,
    /** The newest search did not finish. */
    val searchFailed: Boolean = false,
    val tags: List<String> = emptyList(),
    /** The open actions sheet, or null. */
    val actionSheet: ArticleSheet? = null,
)

/**
 * One-time events for ArticleSearchScreen
 */
sealed interface ArticleSearchEvent {
    data class NavigateToArticle(val itemId: String) : ArticleSearchEvent
    data class ShowToast(val message: String) : ArticleSearchEvent

    /** A failure in fixed words; [retry] repeats what failed. */
    data class ShowError(val message: ErrorMessage, val retry: (() -> Unit)? = null) : ArticleSearchEvent
    data class ShareArticle(val title: String, val url: String) : ArticleSearchEvent
    data class CopyLink(val url: String, val label: String = "Article URL") : ArticleSearchEvent
    data class OpenInBrowser(val url: String) : ArticleSearchEvent

    /** An article was deleted; [undo] takes it back. */
    data class ArticleDeleted(val undo: () -> Unit) : ArticleSearchEvent
}
