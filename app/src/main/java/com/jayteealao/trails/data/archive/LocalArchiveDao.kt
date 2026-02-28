package com.jayteealao.trails.data.archive

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
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

    @Query("DELETE FROM local_archive WHERE itemId = :itemId")
    suspend fun deleteForArticle(itemId: String)

    @Query("SELECT SUM(compressedSizeBytes) FROM local_archive")
    suspend fun totalStorageBytes(): Long?
}
