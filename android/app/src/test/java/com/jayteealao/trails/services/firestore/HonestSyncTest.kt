package com.jayteealao.trails.services.firestore

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.sync.workers.FirestoreSyncWorker
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.jayteealao.trails.testing.TestLocalDataOwner

/**
 * Drives the real sync worker and the real [FirestoreSyncManager] over a real in-memory
 * database; only the Firestore calls are faked. Proves that one failing article makes the
 * worker ask for a retry without moving last sync while the others are stamped, that the
 * same article failing in three runs is skipped by the fourth, which then succeeds and
 * moves last sync, and that a transient failure stops the run without a strike.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class HonestSyncTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao
    private lateinit var backup: FirestoreBackupService
    private lateinit var manager: FirestoreSyncManager

    /** The last-sync value the fake user meta holds. */
    private var remoteLastSync = 1_000L
    private val lastSyncWrites = mutableListOf<Long>()
    /** Item ids of every backup call, one list per call. */
    private val backupCalls = mutableListOf<List<String>>()

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        // The worker's foreground notification reads WorkManager for its cancel intent.
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build()
        )
        db = JvmRoomDatabase.create(context)
        dao = db.articleDao()

        val user = mockk<FirebaseUser>().also { every { it.uid } returns "u1" }
        val auth = mockk<FirebaseAuth>().also { every { it.currentUser } returns user }
        backup = mockk()
        coEvery { backup.getUserMetaSnapshot() } answers {
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = remoteLastSync))
        }
        coEvery { backup.updateLastSyncTimestamp(any()) } answers {
            val at = firstArg<Long>()
            lastSyncWrites += at
            remoteLastSync = at
            Result.success(Unit)
        }
        coEvery { backup.backupArticlesPaginated(any(), any(), any()) } answers {
            val articles = firstArg<List<Article>>()
            backupCalls += articles.map { it.itemId }
            if (articles.any { it.itemId == POISON }) {
                Result.failure(FirebaseFirestoreException("too big", FirebaseFirestoreException.Code.INVALID_ARGUMENT))
            } else {
                Result.success(articles.size)
            }
        }

        manager = FirestoreSyncManager(
            context = context,
            firestore = mockk<FirebaseFirestore>(relaxed = true),
            auth = auth,
            articleDao = dao,
            firestoreBackupService = backup,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = TestLocalDataOwner.ownsEveryUid(),
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun article(itemId: String) = Article(
        itemId = itemId,
        title = "Article $itemId",
        url = "https://example.com/$itemId",
        timeAdded = 2_000,
        timeUpdated = 2_000,
    )

    private suspend fun seedGoodAndPoison() {
        dao.upsertArticles(listOf(article("good1"), article("good2"), article(POISON)))
    }

    private suspend fun runWorker(): ListenableWorker.Result {
        val worker = TestListenableWorkerBuilder<FirestoreSyncWorker>(context).build()
        worker.firestoreSyncManager = manager
        return worker.doWork()
    }

    @Test
    fun oneFailingArticle_workerRetries_lastSyncStays_othersStamped() = runTest {
        seedGoodAndPoison()

        val result = runWorker()

        assertEquals(ListenableWorker.Result.retry(), result)
        assertTrue(lastSyncWrites.isEmpty())
        coVerify(exactly = 0) { backup.updateLastSyncTimestamp(any()) }
        assertEquals(0L, manager.lastSyncTime.value)
        assertNotNull(dao.getArticleById("good1")!!.backedUpAt)
        assertNotNull(dao.getArticleById("good2")!!.backedUpAt)
        val poison = dao.getArticleById(POISON)!!
        assertNull(poison.backedUpAt)
        assertEquals(1, poison.syncFailures)
        // The failed chunk was retried one article at a time: the poison article went out alone once.
        assertEquals(1, backupCalls.count { it == listOf(POISON) })
    }

    @Test
    fun sameArticleFailsThreeRuns_fourthRunSkipsItAndSucceeds() = runTest {
        seedGoodAndPoison()

        for (run in 1..3) {
            assertEquals(ListenableWorker.Result.retry(), runWorker())
            assertEquals(run, dao.getArticleById(POISON)!!.syncFailures)
        }
        assertTrue(lastSyncWrites.isEmpty())

        backupCalls.clear()
        val startedNoEarlierThan = System.currentTimeMillis()
        val fourth = runWorker()
        val finishedNoLaterThan = System.currentTimeMillis()

        assertEquals(ListenableWorker.Result.success(), fourth)
        assertFalse(backupCalls.any { POISON in it })
        // good1 and good2 were stamped by the first run and are not uploaded again.
        assertFalse(backupCalls.any { "good1" in it || "good2" in it })
        assertEquals(1, lastSyncWrites.size)
        assertTrue(lastSyncWrites.single() in startedNoEarlierThan..finishedNoLaterThan)
        assertEquals(lastSyncWrites.single(), manager.lastSyncTime.value)
        assertTrue(manager.lastSyncTime.value > 0)
        assertEquals(1, dao.observeSyncFailureCount().first())
    }

    @Test
    fun transientFailure_stopsRunWithoutStrikeOrStamp() = runTest {
        // Sixty changed articles make two chunks of the regular chunk size (50).
        dao.upsertArticles((1..60).map { article("a$it") })
        coEvery { backup.backupArticlesPaginated(any(), any(), any()) } answers {
            backupCalls += firstArg<List<Article>>().map { it.itemId }
            Result.failure(FirebaseFirestoreException("offline", FirebaseFirestoreException.Code.UNAVAILABLE))
        }

        val result = runWorker()

        assertEquals(ListenableWorker.Result.retry(), result)
        // The loop stopped after the first chunk and did not retry it article by article.
        coVerify(exactly = 1) { backup.backupArticlesPaginated(any(), any(), any()) }
        assertEquals(50, backupCalls.single().size)
        val rows = (1..60).map { dao.getArticleById("a$it")!! }
        assertTrue(rows.all { it.syncFailures == 0 && it.backedUpAt == null })
        assertTrue(lastSyncWrites.isEmpty())
        assertEquals(0, dao.observeSyncFailureCount().first())
    }

    @Test
    fun metaReadFailure_workerRetries_nothingPushed() = runTest {
        seedGoodAndPoison()
        coEvery { backup.getUserMetaSnapshot() } returns
            Result.failure(FirebaseFirestoreException("offline", FirebaseFirestoreException.Code.UNAVAILABLE))

        val result = runWorker()

        assertEquals(ListenableWorker.Result.retry(), result)
        coVerify(exactly = 0) { backup.backupArticlesPaginated(any(), any(), any()) }
        assertTrue(lastSyncWrites.isEmpty())
        assertNull(dao.getArticleById("good1")!!.backedUpAt)
    }

    @Test
    fun editWhileItsPushIsInFlight_staysUnsynced_andTheNextRunSendsIt() = runTest {
        dao.upsertArticles(listOf(article("good1"), article("good2")))
        var edited = false
        coEvery { backup.backupArticlesPaginated(any(), any(), any()) } coAnswers {
            val articles = firstArg<List<Article>>()
            backupCalls += articles.map { it.itemId }
            if (!edited) {
                // The person edits good1 after the chunk was read and before the upload returns.
                edited = true
                Thread.sleep(5)
                dao.updateTimeUpdated("good1", System.currentTimeMillis())
            }
            Result.success(articles.size)
        }

        assertEquals(ListenableWorker.Result.success(), runWorker())
        assertEquals(1, dao.countUnsyncedChanges())

        Thread.sleep(5)
        assertEquals(ListenableWorker.Result.success(), runWorker())
        assertEquals(listOf("good1"), backupCalls.last())
        assertEquals(0, dao.countUnsyncedChanges())
    }

    @Test
    fun runRetriedAfterAnInterruption_sendsOnlyWhatIsStillUnsent() = runTest {
        dao.upsertArticles((1..60).map { article("a$it") })
        var calls = 0
        coEvery { backup.backupArticlesPaginated(any(), any(), any()) } answers {
            val articles = firstArg<List<Article>>()
            backupCalls += articles.map { it.itemId }
            if (++calls == 2) {
                Result.failure(FirebaseFirestoreException("offline", FirebaseFirestoreException.Code.UNAVAILABLE))
            } else {
                Result.success(articles.size)
            }
        }

        assertEquals(ListenableWorker.Result.retry(), runWorker())
        assertEquals(10, dao.countUnsyncedChanges())

        assertEquals(ListenableWorker.Result.success(), runWorker())
        // The 50 rows the first run stamped are not uploaded again.
        assertEquals(10, backupCalls.last().size)
        assertEquals(0, dao.countUnsyncedChanges())
    }

    private companion object {
        const val POISON = "poison"
    }
}
