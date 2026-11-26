package com.jayteealao.trails.data.archive

/** The archive downloads running on this phone, as the clearing of local data sees them. */
interface ArchiveDownloads {
    /** Cancels every download and returns once each has stopped. */
    suspend fun cancelAll()
}
