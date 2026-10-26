package com.jayteealao.trails.data.account

import android.app.Application
import android.content.Context
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import androidx.work.Configuration
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import coil3.SingletonImageLoader
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.local.database.MAX_SYNC_FAILURES
import com.jayteealao.trails.services.firestore.FirestoreCacheReset
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncTimeoutException
import com.jayteealao.trails.sync.workers.FirestoreRestoreWorker
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * The device side of "Clear data" on a real in-memory database: the wipe empties every
 * table and the search index, deletes the archive folder and cancels the sync and restore
 * work; the unsynced count counts exactly the rows Firestore has not confirmed; a push
 * counts as done only on SUCCESS.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class LocalDataResetTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao
    private lateinit var syncManager: FirestoreSyncManager
    private lateinit var reset: LocalDataReset

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build()
        )
        db = JvmRoomDatabase.create(context)
        dao = db.articleDao()
        syncManager = mockk()
        // The wipe holds the sync gate; the stub runs the block as the gate does.
        coEvery { syncManager.runExclusive<Unit>(any()) } coAnswers { firstArg<suspend () -> Unit>().invoke() }
        reset = LocalDataReset(context, dao, syncManager)
        File(context.filesDir, LocalDataReset.ARCHIVES_DIR).deleteRecursively()
    }

    @After
    fun tearDown() {
        db.close()
        File(context.filesDir, LocalDataReset.ARCHIVES_DIR).deleteRecursively()
    }

    private fun article(
        itemId: String,
        title: String = "Article $itemId",
        timeUpdated: Long = 2_000,
        backedUpAt: Long? = null,
        deletedAt: Long? = null,
        syncFailures: Int = 0,
    ) = Article(
        itemId = itemId,
        title = title,
        url = "https://example.com/$itemId",
        timeAdded = 1_000,
        timeUpdated = timeUpdated,
        backedUpAt = backedUpAt,
        deletedAt = deletedAt,
        syncFailures = syncFailures,
    )

    private suspend fun count(sql: String): Long = db.useReaderConnection { connection ->
        connection.usePrepared(sql) { stmt ->
            stmt.step()
            stmt.getLong(0)
        }
    }

    @Test
    fun wipe_emptiesEveryTableAndSearchIndex() = runTest {
        dao.upsertArticles(
            listOf(
                article("a1", title = "The river bank"),
                article("a2", title = "Down the river"),
                article("a3", title = "River stones"),
            )
        )
        db.useWriterConnection { connection ->
            connection.executeSQL("INSERT INTO article_tags (itemId, tag, sortId, type) VALUES ('a1', 'water', 1, 'user')")
            connection.executeSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('i1', 'a1', 'https://example.com/i.png', 1, 1, '', '')"
            )
            connection.executeSQL(
                "INSERT INTO article_videos (videoId, itemId, src, width, height, type, vid) " +
                    "VALUES ('v1', 'a1', 'https://example.com/v.mp4', 1, 1, 'mp4', 'v1')"
            )
            connection.executeSQL(
                "INSERT INTO article_authors (authorId, itemId, name, url) VALUES ('au1', 'a1', 'Ann', 'https://example.com/ann')"
            )
            connection.executeSQL("INSERT INTO DomainMetadata (name, logo, domain) VALUES ('Example', NULL, 'example.com')")
            connection.executeSQL(
                "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) " +
                    "VALUES ('a1', 'readability', 'archives/a1/readability.gz', 10, 20, 1000, 'complete')"
            )
        }
        val archives = File(context.filesDir, LocalDataReset.ARCHIVES_DIR)
        File(archives, "a1").mkdirs()
        File(archives, "a1/readability.gz").writeText("archived page")
        val workManager = WorkManager.getInstance(context)
        val syncRequest = FirestoreSyncWorker.startUpSyncWork()
        workManager.enqueueUniqueWork("FirestoreBackupWork", ExistingWorkPolicy.KEEP, syncRequest).result.get()
        val restoreRequest = FirestoreRestoreWorker.startUpRestoreWork()
        workManager.enqueue(restoreRequest).result.get()
        assertEquals(3L, count("SELECT COUNT(*) FROM article_fts WHERE article_fts MATCH 'river'"))

        reset.wipeLocalData()

        for (table in TABLES) assertEquals("rows in $table", 0L, count("SELECT COUNT(*) FROM $table"))
        assertTrue(dao.searchArticlesRanked("\"river\"", 100).isEmpty())
        assertEquals(0L, count("SELECT COUNT(*) FROM article_fts WHERE article_fts MATCH 'river'"))
        assertFalse(archives.exists())
        assertEquals(WorkInfo.State.CANCELLED, workManager.getWorkInfoById(syncRequest.id).get()!!.state)
        assertEquals(WorkInfo.State.CANCELLED, workManager.getWorkInfoById(restoreRequest.id).get()!!.state)
    }

    @Test
    fun wipe_withoutArchiveFolder_stillEmptiesTables() = runTest {
        dao.upsertArticles(listOf(article("a1")))

        reset.wipeLocalData()

        assertEquals(0L, count("SELECT COUNT(*) FROM article"))
    }

    @Test
    fun wipe_runsInsideTheSyncGate_andAsksForTheFirestoreCacheToBeCleared() = runTest {
        dao.upsertArticles(listOf(article("a1")))
        assertFalse(FirestoreCacheReset.isRequested(context))

        reset.wipeLocalData()

        coVerify(exactly = 1) { syncManager.runExclusive<Unit>(any()) }
        assertEquals(0L, count("SELECT COUNT(*) FROM article"))
        // The previous account's cached Firestore documents are cleared at the next start.
        assertTrue(FirestoreCacheReset.isRequested(context))
    }

    @Test
    fun wipe_emptiesTheImageDiskCache() = runTest {
        val diskCache = SingletonImageLoader.get(context).diskCache!!
        diskCache.openEditor("thumbnail")!!.let { editor ->
            diskCache.fileSystem.write(editor.data) { writeUtf8("cached image") }
            editor.commit()
        }
        diskCache.openSnapshot("thumbnail")!!.close()

        reset.wipeLocalData()

        assertNull(diskCache.openSnapshot("thumbnail"))
    }

    @Test
    fun unsyncedCount_neverBackedUp() = runTest {
        dao.upsertArticles(listOf(article("a", backedUpAt = null)))
        assertEquals(1, reset.pendingChangeCount())
    }

    @Test
    fun unsyncedCount_editedAfterBackup() = runTest {
        dao.upsertArticles(listOf(article("a", timeUpdated = 3_000, backedUpAt = 2_000)))
        assertEquals(1, reset.pendingChangeCount())
    }

    @Test
    fun unsyncedCount_deletedAndNotPushed() = runTest {
        dao.upsertArticles(listOf(article("a", timeUpdated = 3_000, backedUpAt = 2_000, deletedAt = 3_000)))
        assertEquals(1, reset.pendingChangeCount())
    }

    @Test
    fun deletedAndNeverBackedUp_countsUntilTheSweepSendsIt() = runTest {
        // A row deleted before backups were stamped: the never-backed-up sweep picks it
        // up, so a push stamps it and the count does not stay above zero forever.
        dao.upsertArticles(listOf(article("old", timeUpdated = 3_000, backedUpAt = null, deletedAt = 3_000)))
        assertEquals(1, reset.pendingChangeCount())
        assertEquals(listOf("old"), dao.getArticlesNeverBackedUp(50).map { it.itemId })

        dao.recordPushResults(mapOf("old" to 3_000L), emptyList())

        assertEquals(0, reset.pendingChangeCount())
    }

    @Test
    fun unsyncedCount_skippedAfterThreeFailures() = runTest {
        dao.upsertArticles(
            listOf(article("a", timeUpdated = 3_000, backedUpAt = 2_000, syncFailures = MAX_SYNC_FAILURES))
        )
        assertEquals(1, reset.pendingChangeCount())
    }

    @Test
    fun unsyncedCount_stampedAtOrAfterEdit_isZero() = runTest {
        dao.upsertArticles(
            listOf(
                article("same", timeUpdated = 2_000, backedUpAt = 2_000),
                article("later", timeUpdated = 2_000, backedUpAt = 5_000),
            )
        )
        assertEquals(0, reset.pendingChangeCount())
    }

    @Test
    fun unsyncedCount_afterPushStamp_isZero() = runTest {
        dao.upsertArticles(listOf(article("a"), article("b", timeUpdated = 3_000, backedUpAt = 1_000)))
        assertEquals(2, reset.pendingChangeCount())

        dao.recordPushResults(mapOf("a" to 2_000L, "b" to 3_000L), emptyList())

        assertEquals(0, reset.pendingChangeCount())
    }

    @Test
    fun push_successOnlyCountsAsDone() = runTest {
        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(2, 0)
        assertTrue(reset.pushPendingChanges())

        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(1, 1)
        assertFalse(reset.pushPendingChanges())

        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(0, 0, interruptedBy = SyncTimeoutException(120_000))
        assertFalse(reset.pushPendingChanges())

        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(0, 0, noUser = true)
        assertFalse(reset.pushPendingChanges())

        coEvery { syncManager.pushLocalChanges() } throws IllegalStateException("offline")
        assertFalse(reset.pushPendingChanges())
    }

    private companion object {
        val TABLES = listOf(
            "article", "article_tags", "article_images", "article_videos",
            "article_authors", "DomainMetadata", "local_archive",
        )
    }
}
