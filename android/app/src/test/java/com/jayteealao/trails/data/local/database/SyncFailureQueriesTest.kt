package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Runs the push-result, skip, failure-count and reset queries against a real in-memory
 * database on the bundled SQLite engine: a pushed article is stamped and its counter
 * cleared, a failed one gets a strike, an article at MAX_SYNC_FAILURES strikes drops out
 * of the push and reconcile queries and is counted, and a reset brings it back into the
 * next push window. The stamp and the counter live in `sync_state`; a missing row reads as
 * never backed up with 0 strikes, and no stamp or strike updates `article`, so the search
 * index triggers stay silent.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class SyncFailureQueriesTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao

    @Before
    fun setUp() {
        db = JvmRoomDatabase.create(RuntimeEnvironment.getApplication())
        dao = db.articleDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun article(
        itemId: String,
        timeUpdated: Long = 2_000,
        deletedAt: Long? = null,
    ) = Article(
        itemId = itemId,
        title = "Article $itemId",
        url = "https://example.com/$itemId",
        timeAdded = 1_000,
        timeUpdated = timeUpdated,
        deletedAt = deletedAt,
    )

    /** Writes the sync bookkeeping of [id] to `sync_state`. */
    private suspend fun seed(id: String, backedUpAt: Long? = null, syncFailures: Int = 0) =
        dao.upsertSyncState(SyncState(id, backedUpAt, syncFailures))

    /** The sync bookkeeping of [id]; a missing row reads as never backed up, 0 strikes. */
    private suspend fun state(id: String): SyncState = dao.getSyncState(id) ?: SyncState(id)

    @Test
    fun recordPushResults_stampsSuccessesAndStrikesFailures() = runTest {
        dao.upsertArticles(listOf(article("a"), article("b"), article("c")))
        seed("a", syncFailures = 2)
        seed("c", backedUpAt = 100)

        dao.recordPushResults(mapOf("a" to 2_000L, "b" to 2_000L), listOf("c"))

        val a = state("a")
        val b = state("b")
        val c = state("c")
        // The stamp is the version that was sent.
        assertEquals(2_000L, a.backedUpAt)
        assertEquals(0, a.syncFailures)
        assertEquals(2_000L, b.backedUpAt)
        assertEquals(0, b.syncFailures)
        assertEquals(1, c.syncFailures)
        assertEquals(100L, c.backedUpAt)
    }

    @Test
    fun recordPushResults_leavesARowEditedAfterThePushReadItUnstamped() = runTest {
        // The push read version 2_000; an edit stamped 1_500 by a clock read taken before
        // the push read the row, but committed after it, moved the row to a new version.
        dao.upsertArticles(listOf(article("a", timeUpdated = 2_000)))
        seed("a", syncFailures = 1)
        dao.upsertArticles(listOf(article("a", timeUpdated = 1_500)))

        dao.recordPushResults(mapOf("a" to 2_000L), emptyList())

        val a = state("a")
        assertEquals(null, a.backedUpAt)
        assertEquals(1, a.syncFailures)
        assertEquals(listOf("a"), dao.getArticlesModifiedSinceKeyset(0, Long.MAX_VALUE, -1, "", 50).map { it.itemId })
    }

    @Test
    fun regularPush_selectsUnsentRowsOlderThanLastSync_andSkipsSentOnes() = runTest {
        // Last sync is account-wide: another device moved it to 5_000, past this
        // device's unsent edit at 3_000.
        dao.upsertArticles(
            listOf(
                article("unsent", timeUpdated = 3_000),
                article("never", timeUpdated = 2_500),
                article("sent", timeUpdated = 3_000),
            )
        )
        seed("unsent", backedUpAt = 2_000)
        seed("sent", backedUpAt = 3_000)

        val selected = dao.getArticlesModifiedSinceKeyset(5_000, 9_000, -1, "", 50).map { it.itemId }

        assertEquals(listOf("never", "unsent"), selected)
        assertEquals(2, dao.countArticlesModifiedSince(5_000, 9_000))
    }

    @Test
    fun articleAtLimit_isSkippedByPushAndReconcileQueries() = runTest {
        dao.upsertArticles(listOf(article("ok"), article("c")))
        seed("c", syncFailures = MAX_SYNC_FAILURES)

        assertEquals(listOf("ok"), dao.getArticlesModifiedSinceKeyset(0, Long.MAX_VALUE, 0, "", 50).map { it.itemId })
        assertEquals(1, dao.countArticlesModifiedSince(0, Long.MAX_VALUE))
        assertEquals(listOf("ok"), dao.getArticlesNeverBackedUp(50).map { it.itemId })
        assertEquals(1, dao.countArticlesNeverBackedUp())
    }

    @Test
    fun articleBelowLimit_isStillPushed() = runTest {
        dao.upsertArticles(listOf(article("ok"), article("c")))
        seed("c", syncFailures = MAX_SYNC_FAILURES - 1)

        assertEquals(setOf("ok", "c"), dao.getArticlesModifiedSinceKeyset(0, Long.MAX_VALUE, 0, "", 50).map { it.itemId }.toSet())
        assertEquals(2, dao.countArticlesModifiedSince(0, Long.MAX_VALUE))
        assertEquals(setOf("ok", "c"), dao.getArticlesNeverBackedUp(50).map { it.itemId }.toSet())
        assertEquals(2, dao.countArticlesNeverBackedUp())
    }

    @Test
    fun failureCount_emitsOnThirdStrikeAndAfterReset() = runTest {
        dao.upsertArticles(listOf(article("c")))
        seed("c", syncFailures = MAX_SYNC_FAILURES - 1)
        assertEquals(0, dao.observeSyncFailureCount().first())

        // Real dispatcher and real-time timeout: Room delivers invalidations on its own threads.
        withContext(Dispatchers.Default) {
            val emissions = Channel<Int>(Channel.UNLIMITED)
            // Subscribed before the writes, so later emissions can only come from invalidation.
            val collector = launch { dao.observeSyncFailureCount().collect { emissions.send(it) } }
            try {
                withTimeout(5_000) {
                    assertEquals(0, emissions.receive())
                    dao.recordPushResults(emptyMap(), listOf("c"))
                    while (emissions.receive() != 1) Unit
                    dao.resetSyncFailures(now = 9_000)
                    while (emissions.receive() != 0) Unit
                }
            } finally {
                collector.cancel()
            }
        }
    }

    @Test
    fun resetSyncFailures_clearsCounterAndRaisesTimeUpdated() = runTest {
        dao.upsertArticles(
            listOf(
                article("old", timeUpdated = 2_000),
                article("newer", timeUpdated = 10_000),
                article("fine", timeUpdated = 2_000),
            )
        )
        seed("old", syncFailures = MAX_SYNC_FAILURES)
        seed("newer", syncFailures = MAX_SYNC_FAILURES)
        seed("fine", syncFailures = 1)

        val reset = dao.resetSyncFailures(now = 9_000)

        assertEquals(2, reset)
        val old = dao.getArticleById("old")!!
        assertEquals(0, state("old").syncFailures)
        assertEquals(9_000L, old.timeUpdated)
        assertEquals(10_000L, dao.getArticleById("newer")!!.timeUpdated)
        // The row below the limit is not touched.
        assertEquals(1, state("fine").syncFailures)
        assertEquals(2_000L, dao.getArticleById("fine")!!.timeUpdated)
        // Last sync has moved past the old edit, and the reset brings the row back.
        assertTrue(dao.getArticlesModifiedSinceKeyset(5_000, Long.MAX_VALUE, 5_000, "", 50).any { it.itemId == "old" })
    }

    @Test
    fun upsertNewArticle_reSaveKeepsBackupStampAndCounter() = runTest {
        dao.upsertArticles(listOf(article("x")))
        seed("x", backedUpAt = 700, syncFailures = 2)

        val id = dao.upsertNewArticle(
            Article(itemId = "fresh-id", title = "Re-saved", url = "https://example.com/x", timeAdded = 3_000)
        )

        assertEquals("x", id)
        val row = dao.getArticleById("x")!!
        assertEquals(700L, state("x").backedUpAt)
        assertEquals(2, state("x").syncFailures)
        assertEquals(3_000L, row.timeUpdated)
        assertNull(dao.getArticleById("fresh-id"))
    }

    @Test
    fun failureCount_includesDeletedRows() = runTest {
        dao.upsertArticles(listOf(article("gone", deletedAt = 4_000)))
        seed("gone", syncFailures = MAX_SYNC_FAILURES)

        assertEquals(1, dao.observeSyncFailureCount().first())
    }

    @Test
    fun articleWithoutSyncStateRow_isPushedSweptAndUnsynced_butNotCountedAsFailed() = runTest {
        dao.upsertArticles(listOf(article("plain")))
        assertNull(dao.getSyncState("plain"))

        assertEquals(listOf("plain"), dao.getArticlesModifiedSinceKeyset(0, Long.MAX_VALUE, -1, "", 50).map { it.itemId })
        assertEquals(1, dao.countArticlesModifiedSince(0, Long.MAX_VALUE))
        assertEquals(listOf("plain"), dao.getArticlesNeverBackedUp(50).map { it.itemId })
        assertEquals(1, dao.countArticlesNeverBackedUp())
        assertEquals(1, dao.countUnsyncedChanges())
        assertEquals(0, dao.observeSyncFailureCount().first())
    }

    @Test
    fun stampsAndStrikes_doNotUpdateTheArticleRow_onlyRetryDoes() = runTest {
        dao.upsertArticles(listOf(article("a"), article("b"), article("c"), article("d")))
        seed("d", syncFailures = MAX_SYNC_FAILURES)
        // A watch on article updates, on the writer connection that runs every DAO write.
        db.useWriterConnection {
            it.executeSQL("CREATE TEMP TABLE hits(n)")
            it.executeSQL("CREATE TEMP TRIGGER watch AFTER UPDATE ON article BEGIN INSERT INTO hits VALUES (1); END")
        }

        dao.recordPushResults(mapOf("a" to 2_000L), listOf("b"))
        dao.markBackedUpIfUnchanged("c", 2_000)
        dao.incrementSyncFailures(listOf("c"))

        assertEquals(0, hits())
        assertEquals(2_000L, state("a").backedUpAt)
        assertEquals(1, state("b").syncFailures)
        assertEquals(1, state("c").syncFailures)

        // Retry raises timeUpdated of the skipped row: the one documented article write.
        assertEquals(1, dao.resetSyncFailures(now = 9_000))
        assertEquals(1, hits())
    }

    @Test
    fun wipeAllLocalData_emptiesSyncState() = runTest {
        dao.upsertArticles(listOf(article("a")))
        seed("a", backedUpAt = 2_000, syncFailures = 1)

        dao.wipeAllLocalData()

        assertNull(dao.getSyncState("a"))
        assertEquals(0, dao.countUnsyncedChanges())
    }

    @Test
    fun syncStateRowWithoutArticle_isNotCountedAndNotCleared() = runTest {
        seed("ghost", syncFailures = MAX_SYNC_FAILURES)

        assertEquals(0, dao.observeSyncFailureCount().first())
        assertEquals(0, dao.resetSyncFailures(now = 9_000))
        assertEquals(MAX_SYNC_FAILURES, state("ghost").syncFailures)
    }

    private suspend fun hits(): Int = db.useWriterConnection { connection ->
        connection.usePrepared("SELECT COUNT(*) FROM hits") { it.step(); it.getLong(0).toInt() }
    }
}
