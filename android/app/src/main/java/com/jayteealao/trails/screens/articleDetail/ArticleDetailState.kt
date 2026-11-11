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
    /** The archive keys that have a tab: on the phone, or ready on the server and on their way. */
    val tabArchiveKeys: List<String> = emptyList(),
    /** The tab archives that are not on the phone yet. */
    val pendingArchiveKeys: Set<String> = emptySet(),
    /** The pending tab archives whose download failed. */
    val failedArchiveKeys: Set<String> = emptySet(),
    /** A text archive is downloading to the phone; a heavy download does not count. */
    val textDownloading: Boolean = false,
    val textSource: String = "",
    val selectedArchiveContent: String? = null,
    val online: Boolean = true,
    val articleStatus: String? = null,
    /** The selected text archive tab could not read its file. */
    val selectedArchiveLoadFailed: Boolean = false,
    /** What the Reader tab shows: the text, the skeleton, or a quiet notice. */
    val readerBody: ReaderBody = ReaderBody.Loading,
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
