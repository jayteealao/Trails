package com.jayteealao.trails.sync.di

import com.jayteealao.trails.sync.SyncStatusMonitor
import com.jayteealao.trails.sync.status.WorkManagerSyncStatusMonitor
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
interface SyncModule {
    @Binds
    fun bindSyncStatusMonitor(syncStatusMonitor: WorkManagerSyncStatusMonitor): SyncStatusMonitor
}