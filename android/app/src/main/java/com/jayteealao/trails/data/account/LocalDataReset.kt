package com.jayteealao.trails.data.account

import android.content.Context
import androidx.work.WorkManager
import androidx.work.await
import coil3.SingletonImageLoader
import com.jayteealao.trails.data.local.LocalFolders
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunStatus
import com.jayteealao.trails.sync.workers.FirestoreRestoreWorker
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** The device-side operations behind "Clear data" and an account switch. */
@Singleton
class LocalDataReset @Inject constructor(
    @ApplicationContext private val context: Context,
    private val articleDao: ArticleDao,
    private val firestoreSyncManager: FirestoreSyncManager,
) {
    suspend fun pendingChangeCount(): Int = articleDao.countUnsyncedChanges()

    /** True only when the push finished with nothing failed. */
    suspend fun pushPendingChanges(): Boolean = try {
        firestoreSyncManager.pushLocalChanges().status == SyncRunStatus.SUCCESS
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Timber.w(e, "Push before clearing data failed")
        false
    }

    /**
     * Cancel every sync and restore request. Request builders tag each request with its
     * worker class name, so this covers the one-time backup and restore work and the
     * periodic sync.
     */
    suspend fun cancelSyncWork() {
        val workManager = WorkManager.getInstance(context)
        workManager.cancelAllWorkByTag(FirestoreSyncWorker::class.java.name).await()
        workManager.cancelAllWorkByTag(FirestoreRestoreWorker::class.java.name).await()
    }

    /**
     * Stop sync work, delete every table, then delete the archive folder and the cached
     * images (thumbnails and lead images of the cleared library).
     */
    suspend fun wipeLocalData() {
        cancelSyncWork()
        articleDao.wipeAllLocalData()
        withContext(Dispatchers.IO) {
            val archives = File(context.filesDir, ARCHIVES_DIR)
            if (!archives.deleteRecursively() && archives.exists()) {
                Timber.w("Archive folder not fully deleted; the next wipe removes the rest")
            }
            clearImageCache()
        }
    }

    /**
     * Empty the image loader's memory and disk caches. If the loader cannot be reached,
     * delete its cache folder instead.
     */
    private fun clearImageCache() {
        try {
            val imageLoader = SingletonImageLoader.get(context)
            imageLoader.memoryCache?.clear()
            imageLoader.diskCache?.clear()
        } catch (e: Exception) {
            Timber.w(e, "Image cache not cleared through the loader; deleting its folder")
            File(context.cacheDir, LocalFolders.IMAGE_CACHE_DIR).deleteRecursively()
        }
    }

    companion object {
        /** The archive folder under filesDir, the one ArchiveService writes. */
        const val ARCHIVES_DIR = LocalFolders.ARCHIVES_DIR
    }
}
