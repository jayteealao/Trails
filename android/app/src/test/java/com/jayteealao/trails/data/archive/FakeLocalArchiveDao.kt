package com.jayteealao.trails.data.archive

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * In-memory archive table for tests: rows keyed by (itemId, archiveKey), as the
 * Room table is, with a live flow per article.
 */
class FakeLocalArchiveDao : LocalArchiveDao {
    val rows = MutableStateFlow<List<LocalArchive>>(emptyList())

    override fun observeArchives(itemId: String): Flow<List<LocalArchive>> =
        rows.map { all -> all.filter { it.itemId == itemId } }

    override suspend fun getArchivesForArticle(itemId: String): List<LocalArchive> =
        rows.value.filter { it.itemId == itemId }

    override suspend fun getArchive(itemId: String, key: String): LocalArchive? =
        rows.value.find { it.itemId == itemId && it.archiveKey == key }

    override suspend fun upsert(archive: LocalArchive) {
        rows.update { all ->
            all.filterNot { it.itemId == archive.itemId && it.archiveKey == archive.archiveKey } + archive
        }
    }
}
