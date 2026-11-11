package com.jayteealao.trails.screens.articleDetail

import androidx.compose.ui.graphics.vector.ImageVector
import com.jayteealao.trails.data.archive.ArchiveType

/** One tab of the article detail screen; [archiveType] is null for the Reader and Web tabs. */
data class DetailTab(val label: String, val icon: ImageVector, val archiveType: ArchiveType?)

const val READER_TAB_INDEX = 0
const val WEB_TAB_INDEX = 1
const val FIRST_ARCHIVE_TAB_INDEX = 2

/**
 * The tabs of the article detail screen in their fixed order: Reader, Web, then one tab per
 * local archive in [ArchiveType.TAB_ORDER]. The tab row, the tab content and the view model all
 * read this one list, so a tab index always names the same archive in each of them.
 */
fun detailTabsFor(archiveKeys: Collection<String>): List<DetailTab> =
    listOf(
        DetailTab("Reader", ArchiveTabIcons.Reader, null),
        DetailTab("Web", ArchiveTabIcons.Web, null),
    ) + ArchiveType.inTabOrder(archiveKeys).map { DetailTab(it.displayName, it.icon, it) }
