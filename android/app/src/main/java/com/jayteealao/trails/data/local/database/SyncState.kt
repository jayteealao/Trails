package com.jayteealao.trails.data.local.database

import androidx.room3.ColumnInfo
import androidx.room3.Entity
import androidx.room3.PrimaryKey

/**
 * Device-local sync bookkeeping for one article, kept apart from `article` so a stamp or a
 * strike does not rewrite the search index. A missing row means never backed up and no
 * failed runs. Never backed up to Firestore.
 */
@Entity(tableName = "sync_state")
data class SyncState(
    @PrimaryKey val itemId: String,
    /** Epoch-millis version of the article this device last backed up to Firestore (null = never). */
    @ColumnInfo(name = "backed_up_at", defaultValue = "NULL") val backedUpAt: Long? = null,
    /** Failed push runs for the article; at MAX_SYNC_FAILURES the sync skips it. */
    @ColumnInfo(name = "sync_failures", defaultValue = "0") val syncFailures: Int = 0,
)
