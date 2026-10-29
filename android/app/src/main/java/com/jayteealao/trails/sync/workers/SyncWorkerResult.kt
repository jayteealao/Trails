package com.jayteealao.trails.sync.workers

import androidx.work.ListenableWorker
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncRunStatus

/**
 * A run that pushed everything, or had no signed-in user, is done. Any failure asks
 * WorkManager to retry the run with backoff.
 */
internal fun SyncRunResult.toWorkerResult(): ListenableWorker.Result = when (status) {
    SyncRunStatus.SUCCESS, SyncRunStatus.NO_USER -> ListenableWorker.Result.success()
    SyncRunStatus.PARTIAL_FAILURE, SyncRunStatus.FAILURE -> ListenableWorker.Result.retry()
}

/**
 * Turn a retry into a failure once this is the [maxAttempts]th run of the request
 * ([runAttemptCount] counts earlier runs from 0). For work with no strike counter of its
 * own, so a failure that never clears does not repeat forever.
 */
internal fun ListenableWorker.Result.giveUpAfter(runAttemptCount: Int, maxAttempts: Int): ListenableWorker.Result =
    if (this == ListenableWorker.Result.retry() && runAttemptCount + 1 >= maxAttempts) {
        ListenableWorker.Result.failure()
    } else {
        this
    }
