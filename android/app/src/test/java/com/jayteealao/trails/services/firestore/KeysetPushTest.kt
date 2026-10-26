package com.jayteealao.trails.services.firestore

import android.app.Application
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.local.database.SyncState
import com.jayteealao.trails.data.local.database.ArticleSql
import com.jayteealao.trails.data.local.database.MAX_SYNC_FAILURES
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.testing.JvmRoomDatabase
import com.jayteealao.trails.testing.TestLocalDataOwner
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The push loop pages by key over its run window, on the real DAO, the real
 * [FirestoreSyncManager] and a real in-memory database; only the Firestore calls are faked.
 *
 * The main case is the one OFFSET paging got wrong: while the loop runs, every pushed row
 * gets a newer `timeUpdated`, and on the first call five rows of a later page do too.
 * With `ORDER BY timeUpdated DESC LIMIT n OFFSET k`, each such write moved rows between
 * pages, so some rows were skipped and others read twice. With keyset pages of the window
 * (last sync, run start], a row changed during the run leaves this run's window and is
 * pushed by the next run, and every other row is pushed exactly once.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class KeysetPushTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao
    private lateinit var backup: FirestoreBackupService
    private lateinit var manager: FirestoreSyncManager

    private var remoteFirstSync = false
    private var remoteLastSync: Long? = 1_000L

    /** Item ids of every backup call that succeeded, one count per push. */
    private val pushed = mutableMapOf<String, Int>()
    private val calls = mutableListOf<List<String>>()
    private val rowsArguments = mutableListOf<Map<String, ArticleRows>>()

    /** Runs inside each backup call before it answers; real DAO writes while the loop runs. */
    private var duringPush: suspend (List<Article>) -> Unit = {}
    private var failing: Set<String> = emptySet()

    @Before
    fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        db = JvmRoomDatabase.create(context)
        dao = db.articleDao()

        val user = mockk<FirebaseUser>().also { every { it.uid } returns "u1" }
        val auth = mockk<FirebaseAuth>().also { every { it.currentUser } returns user }
        backup = mockk()
        coEvery { backup.getUserMetaSnapshot() } answers {
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = remoteFirstSync, lastSyncTimestamp = remoteLastSync))
        }
        coEvery { backup.updateLastSyncTimestamp(any()) } answers {
            remoteLastSync = firstArg()
            remoteFirstSync = false
            Result.success(Unit)
        }
        coEvery { backup.backupArticlesPaginated(any(), any(), any(), any()) } coAnswers {
            val articles = firstArg<List<Article>>()
            calls += articles.map { it.itemId }
            rowsArguments += arg<Map<String, ArticleRows>>(3)
            duringPush(articles)
            if (articles.any { it.itemId in failing }) {
                Result.failure(FirebaseFirestoreException("too big", FirebaseFirestoreException.Code.INVALID_ARGUMENT))
            } else {
                articles.forEach { pushed.merge(it.itemId, 1, Int::plus) }
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

    private fun id(n: Int) = "k%03d".format(n)

    private fun article(n: Int, timeUpdated: Long, deleted: Boolean = false) = Article(
        itemId = id(n),
        title = "Article $n",
        url = "https://example.com/${id(n)}",
        timeAdded = 1_500,
        timeUpdated = timeUpdated,
        deletedAt = if (deleted) timeUpdated else null,
    )

    /**
     * Stores [articles] backed up before (stamp 1_500 in sync_state), so only the push loop
     * (not the never-backed-up sweep) sends them; [strikes] gives an article's failed runs.
     */
    private suspend fun insert(articles: List<Article>, strikes: Map<String, Int> = emptyMap()) {
        dao.upsertArticles(articles)
        articles.forEach { dao.upsertSyncState(SyncState(it.itemId, 1_500, strikes[it.itemId] ?: 0)) }
    }

    /**
     * One push run on a real dispatcher: the fake backup call writes to Room, which suspends,
     * and on the test scheduler's virtual clock the push timeout would fire at once.
     */
    private suspend fun push(): SyncRunResult = withContext(Dispatchers.Default) { manager.pushLocalChanges() }

    /** Waits until the clock is past [millis], so the next run's window covers it. */
    private fun clockPast(millis: Long) {
        while (System.currentTimeMillis() <= millis) Thread.sleep(2)
    }

    @Test
    fun rowsChangedDuringTheLoop_eachArticlePushedExactlyOnce() = runTest {
        // 500 rows changed after last sync (1_000): timeUpdated 2_000…2_499, 50 deleted, and
        // rows 90…109 share one timeUpdated, across the boundary of pages 2 and 3, so the
        // itemId tiebreak decides their order.
        insert(
            (0 until 500).map { n -> article(n, timeUpdated = if (n in 90..109) 2_090L else 2_000L + n, deleted = n % 10 == 3) }
        )
        val bumpedBeforeRead = (480 until 485).map(::id).toSet() // all on the last page
        var maxBump = 0L
        var firstCall = true
        duringPush = { articles ->
            val ids = articles.map { it.itemId } + if (firstCall) bumpedBeforeRead else emptySet()
            firstCall = false
            for (itemId in ids) {
                val at = System.currentTimeMillis() + 1
                dao.updateTimeUpdated(itemId, at)
                maxBump = maxOf(maxBump, at)
            }
        }

        val first = push()

        assertEquals(SyncRunStatus.SUCCESS, first.status)
        val everyId = (0 until 500).map(::id).toSet()
        assertEquals(everyId - bumpedBeforeRead, pushed.keys)
        assertTrue("an article was pushed twice in one run: $pushed", pushed.values.all { it == 1 })
        assertEquals(10, calls.size)

        // The next run's window starts at this run's start: it pushes every row changed
        // during the first run once, the five rows changed before they were read included.
        duringPush = {}
        clockPast(maxBump)
        val afterFirst = pushed.toMap()
        pushed.clear()
        val second = push()

        assertEquals(SyncRunStatus.SUCCESS, second.status)
        assertEquals(everyId, pushed.keys)
        assertTrue(pushed.values.all { it == 1 })
        // Across both runs: once for each row changed before it was read, twice for each row
        // changed after its push (that later change is the second run's to push).
        val total = everyId.associateWith { (afterFirst[it] ?: 0) + (pushed[it] ?: 0) }
        assertEquals(everyId.associateWith { if (it in bumpedBeforeRead) 1 else 2 }, total)

        // Nothing changed during the second run, so a third run pushes nothing.
        pushed.clear()
        clockPast(System.currentTimeMillis())
        assertEquals(SyncRunStatus.SUCCESS, push().status)
        assertTrue("the third run pushed $pushed", pushed.isEmpty())
    }

    @Test
    fun firstSync_pushesEveryRowOnceInPagesOfFifty() = runTest {
        remoteFirstSync = true
        remoteLastSync = null
        insert((0 until 250).map { article(it, timeUpdated = 100L + it) })

        val result = push()

        assertEquals(SyncRunStatus.SUCCESS, result.status)
        assertEquals(5, calls.size)
        assertTrue(calls.all { it.size == 50 })
        assertEquals((0 until 250).map(::id).toSet(), pushed.keys)
        assertTrue(pushed.values.all { it == 1 })
    }

    @Test
    fun thirdStrikeDuringTheRun_shiftsNoOtherRow() = runTest {
        insert(
            (0 until 120).map { n -> article(n, timeUpdated = 2_000L + n) },
            strikes = mapOf(id(10) to MAX_SYNC_FAILURES - 1),
        )
        failing = setOf(id(10))

        val result = push()

        assertEquals(SyncRunStatus.PARTIAL_FAILURE, result.status)
        assertEquals(MAX_SYNC_FAILURES, dao.getSyncState(id(10))!!.syncFailures)
        assertEquals((0 until 120).map(::id).toSet() - id(10), pushed.keys)
        assertTrue(pushed.values.all { it == 1 })
    }

    @Test
    fun imageRowsRideTheKeysetPages() = runTest {
        insert((0 until 3).map { article(it, timeUpdated = 2_000L + it) })
        val image = ArticleImages(imageId = "img1", itemId = id(1), src = "https://example.com/i.png", width = 1, height = 1, credit = "", caption = "")
        dao.insertArticleImages(listOf(image))

        push()

        assertEquals(1, calls.size)
        assertEquals(listOf(image), rowsArguments.single().getValue(id(1)).images)
    }

    @Test
    fun syncQueriesUseNoOffset() {
        for (sql in listOf(
            ArticleSql.CHANGED_SINCE_KEYSET,
            ArticleSql.COUNT_CHANGED_SINCE,
            ArticleSql.NEVER_BACKED_UP,
            ArticleSql.COUNT_NEVER_BACKED_UP,
        )) {
            assertFalse(sql, sql.contains("OFFSET", ignoreCase = true))
        }
        assertTrue(ArticleDao::class.java.methods.none { it.name == "getArticlesModifiedSincePaginated" })
    }
}
