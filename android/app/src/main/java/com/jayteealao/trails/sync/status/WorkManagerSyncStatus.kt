package com.jayteealao.trails.sync.status

import android.content.Context
import androidx.lifecycle.asFlow
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.jayteealao.trails.sync.SyncStatusMonitor
import com.jayteealao.trails.sync.initializers.SyncWorkName
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * [SyncStatusMonitor] backed by [WorkInfo] from [WorkManager].
 */
class WorkManagerSyncStatusMonitor @Inject constructor(
    @ApplicationContext context: Context
) : SyncStatusMonitor {
    override val isSyncing: Flow<Boolean> =
        WorkManager.getInstance(context)
            .getWorkInfosForUniqueWorkLiveData(SyncWorkName)
            .asFlow()
            .map { it.anyRunning }.conflate()
//        Transformations.map(
//        WorkManager.getInstance(context).getWorkInfosForUniqueWorkLiveData(SyncWorkName),
//        MutableList<WorkInfo>::anyRunning
//    ).asFlow().conflate()
}

private val List<WorkInfo>.anyRunning get() = any { it.state == WorkInfo.State.RUNNING }
