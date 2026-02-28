package com.jayteealao.trails.data.archive

import androidx.room.Entity

/**
 * Tracks which archives have been downloaded and stored locally as gzipped files.
 */
@Entity(
    tableName = "local_archive",
    primaryKeys = ["itemId", "archiveKey"],
)
data class LocalArchive(
    val itemId: String,
    val archiveKey: String,
    val localPath: String,
    val compressedSizeBytes: Long,
    val originalSizeBytes: Long,
    val downloadedAt: Long,
    val status: String = "complete",
)
