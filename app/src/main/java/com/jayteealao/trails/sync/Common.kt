package com.jayteealao.trails.sync

import kotlinx.coroutines.flow.Flow

/**
 * Reports on if synchronization is in progress.
 */
interface SyncStatusMonitor {
    val isSyncing: Flow<Boolean>
}