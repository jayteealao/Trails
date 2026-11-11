package com.jayteealao.trails.screens.articleDetail

import androidx.compose.ui.graphics.vector.ImageVector
import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType

/** One tab of the article detail screen; [archiveType] is null for the Reader and Web tabs. */
data class DetailTab(val label: String, val icon: ImageVector, val archiveType: ArchiveType?)

const val READER_TAB_INDEX = 0
const val WEB_TAB_INDEX = 1
const val FIRST_ARCHIVE_TAB_INDEX = 2

/**
 * The tabs of the article detail screen in their fixed order: Reader, Web, then one tab per
 * archive of [archiveKeys] ([tabArchiveKeys]) in [ArchiveType.TAB_ORDER]. The tab row, the tab content and the view model all
 * read this one list, so a tab index always names the same archive in each of them.
 */
fun detailTabsFor(archiveKeys: Collection<String>): List<DetailTab> =
    listOf(
        DetailTab("Reader", ArchiveTabIcons.Reader, null),
        DetailTab("Web", ArchiveTabIcons.Web, null),
    ) + ArchiveType.inTabOrder(archiveKeys).map { DetailTab(it.displayName, it.icon, it) }

/**
 * The archive keys that have a tab: each archive on the phone, and each archive that is ready on
 * the server and so is on its way to the phone. A tab whose archive is still on its way shows
 * that it is loading, so the person sees which tabs are coming.
 */
fun tabArchiveKeys(localKeys: Collection<String>, remote: Map<String, ArchiveStatus>): List<String> =
    (localKeys + remote.filterValues { it.isReady }.keys).distinct()
