package com.jayteealao.trails.data.archive

import androidx.room3.Dao
import androidx.room3.Query
import androidx.room3.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalArchiveDao {

    @Query("SELECT * FROM local_archive WHERE itemId = :itemId")
    fun observeArchives(itemId: String): Flow<List<LocalArchive>>

    @Query("SELECT * FROM local_archive WHERE itemId = :itemId")
    suspend fun getArchivesForArticle(itemId: String): List<LocalArchive>

    @Query("SELECT * FROM local_archive WHERE itemId = :itemId AND archiveKey = :key")
    suspend fun getArchive(itemId: String, key: String): LocalArchive?

    @Upsert
    suspend fun upsert(archive: LocalArchive)
}
