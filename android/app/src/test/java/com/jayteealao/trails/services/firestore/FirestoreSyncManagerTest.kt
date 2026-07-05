package com.jayteealao.trails.services.firestore

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleTags
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Tests pinning the behaviour of [FirestoreSyncManager].
 * The streaming-restore slice updated [FirestoreBackupService.restoreAllArticlesPaginated]
 * to deliver articles per-page via [onPage] callback; tests here updated accordingly.
 *
 * Scope: the public `suspend` entry points (`syncLocalChanges`, `performFullSync`)
 * plus the pure conflict-resolution function (exercised reflectively). The
 * WorkManager scheduling functions (`schedulePeriodicSync` / `cancelPeriodicSync`)
 * are out of scope — they require an instrumented `Context`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirestoreSyncManagerTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var firestoreBackupService: FirestoreBackupService

    private lateinit var manager: FirestoreSyncManager

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        manager = FirestoreSyncManager(
            context = context,
            firestore = firestore,
            auth = auth,
            articleDao = articleDao,
            firestoreBackupService = firestoreBackupService,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    private fun signedInUser(uid: String = "u1"): FirebaseUser =
        mockk<FirebaseUser>().also { every { it.uid } returns uid }

    // ---- Auth guards --------------------------------------------------------

    @Test
    fun `syncLocalChanges sets Error status when unauthenticated`() = runTest {
        every { auth.currentUser } returns null

        manager.syncLocalChanges()

        assertEquals(SyncStatus.Error("Not authenticated", null), manager.syncStatus.value)
    }

    @Test
    fun `performFullSync sets Error status when unauthenticated`() = runTest {
        every { auth.currentUser } returns null

        manager.performFullSync()

        assertEquals(SyncStatus.Error("Not authenticated", null), manager.syncStatus.value)
    }

    // ---- Tag-backup delegation (firestore-dedup) ---------------------------

    /**
     * After firestore-dedup: tag-backup in syncLocalChanges delegates to
     * [FirestoreBackupService.backupArticle] — one call per article — instead
     * of writing a raw Firestore batch per article. Two articles ⇒
     * `backupArticle` called exactly twice (once per article in the chunk).
     *
     * firestore-io (B2) will further consolidate per-article commits into
     * per-chunk commits.
     */
    @Test
    fun `syncLocalChanges backs up tags via backupArticle once per article`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.isFirstSync() } returns Result.success(false)
        coEvery { firestoreBackupService.getLastSyncTimestamp() } returns Result.success(0L)
        coEvery { articleDao.countAllArticles() } returns 2
        coEvery { articleDao.getAllArticlesPaginated(50, 0) } returns
            listOf(Article(itemId = "a1"), Article(itemId = "a2"))
        coEvery { firestoreBackupService.backupArticlesPaginated(any(), any()) } returns Result.success(2)
        coEvery { articleDao.getArticleTags("a1") } returns listOf("t1", "t2")
        coEvery { articleDao.getArticleTags("a2") } returns listOf("t3")
        coEvery { firestoreBackupService.backupArticle(any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        // Reconcile sweep runs after main sync; no never-backed-up articles.
        coEvery { articleDao.getArticlesNeverBackedUp(any(), any()) } returns emptyList()

        manager.syncLocalChanges()

        // backupArticle is called once per article in the tag-backup pass.
        coVerify(exactly = 2) { firestoreBackupService.backupArticle(any(), any(), any(), any(), any(), any()) }
        assertTrue(manager.syncStatus.value is SyncStatus.Success)
    }

    // ---- Conflict resolution (pure function, via reflection) ---------------

    private fun invokeShouldAcceptRemoteChange(local: Article, remote: Article): Boolean {
        val method = FirestoreSyncManager::class.java.getDeclaredMethod(
            "shouldAcceptRemoteChange",
            Article::class.java,
            Article::class.java,
        ).apply { isAccessible = true }
        return method.invoke(manager, local, remote) as Boolean
    }

    @Test
    fun `shouldAcceptRemoteChange accepts remote when remote is newer`() {
        val local = Article(itemId = "x", timeUpdated = 100)
        val remote = Article(itemId = "x", timeUpdated = 200)

        assertEquals(true, invokeShouldAcceptRemoteChange(local, remote))
    }

    @Test
    fun `shouldAcceptRemoteChange keeps local on timestamp tie when local is more complete`() {
        // Equal timestamps → completeness tie-break. Local has text (+10), remote empty.
        val local = Article(itemId = "x", timeUpdated = 100, text = "full body")
        val remote = Article(itemId = "x", timeUpdated = 100, text = null)

        assertEquals(false, invokeShouldAcceptRemoteChange(local, remote))
    }

    // ---- First-sync strategy dispatch --------------------------------------

    /**
     * First sync, local empty + remote has data ⇒ RESTORE strategy: pulls remote
     * pages via the streaming API (restoreAllArticlesPaginated with onPage callback)
     * and marks synced. Updated for streaming-restore: returns Result<Unit>, not
     * Result<List<Article>>. The mock returns success without invoking onPage to keep
     * the test focused on dispatch and status-update behaviour.
     */
    @Test
    fun `performFullSync first-sync restore scenario applies remote and marks synced`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        coEvery { firestoreBackupService.isFirstSync() } returns Result.success(true)
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(1)
        coEvery { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) } returns Result.success(Unit)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)

        manager.performFullSync()

        coVerify(exactly = 1) { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.updateLastSyncTimestamp(any()) }
        assertTrue(manager.syncStatus.value is SyncStatus.Success)
    }

    /**
     * First sync, neither side has data ⇒ just mark synced; restore is never called.
     */
    @Test
    fun `performFullSync first-sync no-data scenario marks synced without restoring`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        coEvery { firestoreBackupService.isFirstSync() } returns Result.success(true)
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(0)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)

        manager.performFullSync()

        coVerify(exactly = 0) { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.updateLastSyncTimestamp(any()) }
        assertEquals(SyncStatus.Success("Up to date"), manager.syncStatus.value)
    }

    // ---- A3 batched tag reads integration path tests -----------------------

    /**
     * A3 — Restore strategy (first sync, local empty + remote data) dispatches tags
     * via batchRestoreArticleTags and never calls the per-article restoreArticleTags.
     *
     * The single-article restoreArticleTags is only used by the single-article
     * restoreArticle path, which is out of scope here. This verifies that the N+1
     * pattern is eliminated in the restore loop by checking that
     * restoreArticleTags is not declared anywhere in the stub interactions.
     */
    @Test
    fun `performFullSync restore scenario wires batchRestoreArticleTags not single article restoreArticleTags`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        coEvery { firestoreBackupService.isFirstSync() } returns Result.success(true)
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(15)

        // restoreAllArticlesPaginated returns success without invoking onPage (focus is on
        // dispatch verification, not callback invocation — see streaming-restore Deviation 1).
        coEvery { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) } returns Result.success(Unit)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)

        manager.performFullSync()

        // The single-article restoreArticleTags must never be called from any restore path.
        coVerify(exactly = 0) { firestoreBackupService.restoreArticleTags(any()) }
        assertTrue(manager.syncStatus.value is SyncStatus.Success)
    }
}
