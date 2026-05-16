package com.jayteealao.trails.sync

import androidx.work.Constraints
import kotlinx.coroutines.flow.Flow

/**
 * Reports on if synchronization is in progress.
 */
interface SyncStatusMonitor {
    val isSyncing: Flow<Boolean>
}

val constraints = Constraints.Builder()
//    .setRequiredNetworkType(NetworkType.CONNECTED)
    .build()
