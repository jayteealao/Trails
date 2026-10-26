package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.data.local.database.ArticleDao
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * The articles the sync skips after MAX_SYNC_FAILURES failed runs, and the retry the
 * Settings failure row offers.
 */
class SyncFailures @Inject constructor(
    private val articleDao: ArticleDao,
    private val firestoreSyncManager: FirestoreSyncManager,
) {
    /** How many articles the sync currently skips. */
    fun observeCount(): Flow<Int> = articleDao.observeSyncFailureCount()

    /**
     * Clear the counters of the skipped articles (raising their `timeUpdated`, so the push
     * selects them), then push once and report what happened.
     */
    suspend fun retry(): SyncRunResult {
        articleDao.resetSyncFailures(System.currentTimeMillis())
        return firestoreSyncManager.pushLocalChanges()
    }
}
