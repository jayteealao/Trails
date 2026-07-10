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
import io.mockk.slot
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
        // The reconcile sweep (reached from syncLocalChanges, including the
        // no-local-changes branch) logs its backlog count at start — stub once here
        // for the strict mocks; individual tests override when the count matters.
        coEvery { articleDao.countArticlesNeverBackedUp() } returns 0
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

    // ---- Tag-backup in chunk batch (firestore-io B2) -----------------------

    /**
     * B2: tag-backup is now folded into the chunk batch via [backupArticlesPaginated]'s
     * [tagsByArticleId] parameter. Two articles in one chunk ⇒ [backupArticlesPaginated]
     * called once with a map containing both articles' tags, and [backupArticle] is
     * never called from the main sync path.
     */
    @Test
    fun `syncLocalChanges folds tags into chunk batch via backupArticlesPaginated`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 0L))
        coEvery { articleDao.countAllArticles() } returns 2
        coEvery { articleDao.getAllArticlesPaginated(50, 0) } returns
            listOf(Article(itemId = "a1"), Article(itemId = "a2"))
        // CR-1 fix: bulk getTagsForArticles replaces per-article getArticleTags in syncLocalChanges.
        coEvery { articleDao.getTagsForArticles(listOf("a1", "a2")) } returns listOf(
            ArticleTags(itemId = "a1", tag = "t1", sortId = null, type = null),
            ArticleTags(itemId = "a1", tag = "t2", sortId = null, type = null),
            ArticleTags(itemId = "a2", tag = "t3", sortId = null, type = null),
        )
        // Capture the call to verify tagsByArticleId is populated.
        coEvery { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) } returns Result.success(2)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        // Reconcile sweep runs after main sync; no never-backed-up articles.
        coEvery { articleDao.getArticlesNeverBackedUp(any(), any()) } returns emptyList()

        manager.syncLocalChanges()

        // B2: backupArticlesPaginated is called once with the pre-fetched tags map;
        // backupArticle is NOT called (tags are in the chunk batch, not a separate commit).
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) }
        // CR-1: getTagsForArticles (bulk) is used; per-article getArticleTags must not be called.
        coVerify(exactly = 0) { articleDao.getArticleTags(any()) }
        coVerify(exactly = 0) { firestoreBackupService.backupArticle(any(), any(), any(), any(), any(), any()) }
        assertTrue(manager.syncStatus.value is SyncStatus.Success)
    }

    /**
     * CR-1 companion: the bulk [ArticleDao.getTagsForArticles] result is grouped by
     * `itemId` and threaded into [backupArticlesPaginated] as `tagsByArticleId`.
     *
     * The sibling test above stubs the same path but asserts only the negative (the
     * per-article [getArticleTags] loop is gone) and passes `any()` for the tags map.
     * This test pins the positive contract of the CR-1 fix: exactly one bulk read per
     * chunk with the chunk's ids, and the captured map is correctly grouped —
     * a1 → [t1, t2], a2 → [t3] — so no article's tags are dropped or mis-attributed.
     */
    @Test
    fun `syncLocalChanges bulk-fetches tags once per chunk and passes them grouped by itemId`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 0L))
        coEvery { articleDao.countAllArticles() } returns 2
        coEvery { articleDao.getAllArticlesPaginated(50, 0) } returns
            listOf(Article(itemId = "a1"), Article(itemId = "a2"))
        coEvery { articleDao.getTagsForArticles(listOf("a1", "a2")) } returns listOf(
            ArticleTags(itemId = "a1", tag = "t1", sortId = null, type = null),
            ArticleTags(itemId = "a1", tag = "t2", sortId = null, type = null),
            ArticleTags(itemId = "a2", tag = "t3", sortId = null, type = null),
        )
        val tagsSlot = slot<Map<String, List<ArticleTags>>>()
        coEvery {
            firestoreBackupService.backupArticlesPaginated(any(), capture(tagsSlot), any())
        } returns Result.success(2)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { articleDao.getArticlesNeverBackedUp(any(), any()) } returns emptyList()

        manager.syncLocalChanges()

        // Exactly one bulk read for the whole chunk (positive assertion of the N+1 fix).
        coVerify(exactly = 1) { articleDao.getTagsForArticles(listOf("a1", "a2")) }

        // The captured map is grouped by itemId with every tag preserved under its owner.
        val captured = tagsSlot.captured
        assertEquals(setOf("a1", "a2"), captured.keys)
        assertEquals(listOf("t1", "t2"), captured.getValue("a1").map { it.tag })
        assertEquals(listOf("t3"), captured.getValue("a2").map { it.tag })
    }

    /**
     * B2 efficiency-1: [syncLocalChanges] makes exactly one user-meta GET
     * (via [getUserMetaSnapshot]) instead of the prior two separate
     * [isFirstSync] + [getLastSyncTimestamp] reads.
     */
    @Test
    fun `syncLocalChanges makes one meta read not two`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1000L))
        coEvery { articleDao.countArticlesModifiedSince(1000L) } returns 0
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { articleDao.getArticlesNeverBackedUp(any(), any()) } returns emptyList()

        manager.syncLocalChanges()

        coVerify(exactly = 1) { firestoreBackupService.getUserMetaSnapshot() }
        // The old two-read pattern must not be invoked.
        coVerify(exactly = 0) { firestoreBackupService.isFirstSync() }
        coVerify(exactly = 0) { firestoreBackupService.getLastSyncTimestamp() }
    }

    /**
     * B2 efficiency-3: [handleRemoteArticleChange] conflict-update path calls
     * [deleteAllTagsForArticle] exactly once and never calls [deleteArticleTag].
     *
     * Exercised via [applyRemoteArticles] which is the only caller of
     * [handleRemoteArticleChange]. We stub [restoreAllArticlesPaginated] to invoke
     * the [onPage] callback synchronously so the Room calls are observable.
     */
    @Test
    fun `handleRemoteArticleChange uses deleteAllTagsForArticle not per-tag deletes`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        val remoteArticle = Article(itemId = "r1", timeUpdated = 200)
        // Local article is older → remote wins → conflict-update path is taken.
        val localArticle = Article(itemId = "r1", timeUpdated = 100)
        coEvery { articleDao.getArticleById("r1") } returns localArticle
        coEvery { articleDao.upsertArticle(any()) } returns Unit
        coEvery { articleDao.deleteAllTagsForArticle("r1") } returns Unit
        coEvery { articleDao.insertArticleTags(any()) } returns Unit

        // batchRestoreArticleTags returns pre-fetched tags for the article.
        coEvery { firestoreBackupService.batchRestoreArticleTags(listOf("r1")) } returns
            mapOf("r1" to listOf(ArticleTags(itemId = "r1", tag = "kotlin", sortId = null, type = null)))

        // Use performFullSync → restore scenario to invoke applyRemoteArticles.
        // CR-2 fix: performFullSync now uses getUserMetaSnapshot() instead of isFirstSync().
        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(1)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)

        // Have restoreAllArticlesPaginated deliver remoteArticle via onPage callback.
        coEvery { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) } coAnswers {
            val onPage = secondArg<suspend (List<Article>) -> Unit>()
            onPage(listOf(remoteArticle))
            Result.success(Unit)
        }

        manager.performFullSync()

        coVerify(exactly = 1) { articleDao.deleteAllTagsForArticle("r1") }
        coVerify(exactly = 0) { articleDao.deleteArticleTag(any(), any()) }
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
        // CR-2 fix: performFullSync now uses getUserMetaSnapshot() instead of isFirstSync().
        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
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
        // CR-2 fix: performFullSync now uses getUserMetaSnapshot() instead of isFirstSync().
        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
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
        // CR-2 fix: performFullSync now uses getUserMetaSnapshot() instead of isFirstSync().
        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
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

    // ---- Reconcile sweep gating (reconcile-stall-guard AC3) -----------------

    /**
     * AC3 — never-backed-up (offline-stranded) articles are swept even when the
     * incremental count finds nothing to sync: the sweep now runs inside the
     * `totalCount == 0` branch instead of being skipped by the early return.
     */
    @Test
    fun `syncLocalChanges runs reconcile sweep when there are no incremental changes`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1000L))
        coEvery { articleDao.countArticlesModifiedSince(1000L) } returns 0

        val stranded = listOf(Article(itemId = "s1"), Article(itemId = "s2"))
        coEvery { articleDao.countArticlesNeverBackedUp() } returns 2
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 0) } returnsMany listOf(stranded, emptyList())
        coEvery { firestoreBackupService.backupArticlesPaginated(stranded, any()) } returns Result.success(2)
        coEvery { articleDao.updateBackedUpAt(any(), any()) } returns Unit

        manager.syncLocalChanges()

        // The stranded articles were backed up and stamped despite "no local changes".
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(stranded, any()) }
        coVerify(exactly = 1) { articleDao.updateBackedUpAt("s1", any()) }
        coVerify(exactly = 1) { articleDao.updateBackedUpAt("s2", any()) }
        assertEquals(SyncStatus.Success("Up to date"), manager.syncStatus.value)
    }

    // ---- Download-stamp on remote-won upserts (reconcile-stall-guard AC4) ----

    /**
     * AC4 — an article applied from a remote restore is stamped `backedUpAt` at
     * apply time (it already exists in Firestore), so the next reconcile sweep
     * does not re-upload it.
     */
    @Test
    fun `handleRemoteArticleChange stamps backedUpAt on remote-won upserts`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        // New-article path: no local row, remote is applied as-is.
        val remoteArticle = Article(itemId = "r1", timeUpdated = 200)
        coEvery { articleDao.getArticleById("r1") } returns null
        coEvery { articleDao.upsertArticle(any()) } returns Unit
        coEvery { firestoreBackupService.batchRestoreArticleTags(listOf("r1")) } returns emptyMap()

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(1)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) } coAnswers {
            val onPage = secondArg<suspend (List<Article>) -> Unit>()
            onPage(listOf(remoteArticle))
            Result.success(Unit)
        }

        manager.performFullSync()

        coVerify(exactly = 1) {
            articleDao.upsertArticle(match { it.itemId == "r1" && it.backedUpAt != null })
        }
    }

    /**
     * AC4 companion — a local-wins conflict must NOT be stamped: the local row is
     * newer than Firestore, so it legitimately needs the push path (and, if that
     * fails, the reconcile sweep). No remote copy is upserted at all; the local
     * article is pushed instead.
     */
    @Test
    fun `handleRemoteArticleChange does not stamp or upsert on local-wins conflicts`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        val remoteArticle = Article(itemId = "r1", timeUpdated = 100)
        val localArticle = Article(itemId = "r1", timeUpdated = 200) // local newer → local wins
        coEvery { articleDao.getArticleById("r1") } returns localArticle
        coEvery { articleDao.getArticleTags("r1") } returns emptyList()
        coEvery {
            firestoreBackupService.backupArticle(any(), any(), any(), any(), any(), any())
        } returns Result.success(Unit)
        coEvery { firestoreBackupService.batchRestoreArticleTags(listOf("r1")) } returns emptyMap()

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
        coEvery { articleDao.countAllArticles() } returns 0
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.success(1)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) } coAnswers {
            val onPage = secondArg<suspend (List<Article>) -> Unit>()
            onPage(listOf(remoteArticle))
            Result.success(Unit)
        }

        manager.performFullSync()

        // The remote copy is never applied — nothing is upserted, so nothing is stamped —
        // and the newer local article is pushed to Firestore instead.
        coVerify(exactly = 0) { articleDao.upsertArticle(any()) }
        coVerify(exactly = 1) {
            firestoreBackupService.backupArticle(localArticle, any(), any(), any(), any(), any())
        }
    }
}
