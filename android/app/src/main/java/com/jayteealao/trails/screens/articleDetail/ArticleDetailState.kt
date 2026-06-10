package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.local.database.Article

/**
 * Consolidated UI state for ArticleDetailScreen
 */
data class ArticleDetailState(
    val article: Article? = null,
    val selectedTabIndex: Int = 1, // Default to Web view (tab 1)
    val useFreedium: Boolean = false,
    val isLoading: Boolean = false,
    val remoteArchives: Map<String, ArchiveStatus> = emptyMap(),
    val localArchives: List<LocalArchive> = emptyList(),
    val archiveSyncing: Boolean = false,
    val textSource: String = "",
    val selectedArchiveContent: String? = null,
)

/**
 * One-time events for ArticleDetailScreen
 */
sealed interface ArticleDetailEvent {
    data class ShowToast(val message: String) : ArticleDetailEvent
    data class ArticleMarkedAsRead(val itemId: String) : ArticleDetailEvent
    data object NavigateBack : ArticleDetailEvent
    data class ShowError(val error: Throwable) : ArticleDetailEvent
}
