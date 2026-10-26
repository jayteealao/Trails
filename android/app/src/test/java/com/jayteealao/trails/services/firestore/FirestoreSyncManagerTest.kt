package com.jayteealao.trails.services.firestore

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import com.jayteealao.trails.testing.TestLocalDataOwner

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
        // Every push run records its per-article results (stamps and strikes) in Room.
        coEvery { articleDao.recordPushResults(any(), any()) } returns Unit
        // Every push chunk reads its articles' tags; none unless a test says otherwise.
        coEvery { articleDao.getTagsForArticles(any()) } returns emptyList()
        // A run with nothing left to push checks whether its window saw any change.
        coEvery { articleDao.countArticlesChangedInWindow(any(), any()) } returns 0
        // Every push chunk and local-wins push reads the articles' image and author rows,
        // and every restore page fetches them; no rows unless a test says otherwise.
        coEvery { articleDao.getImagesForArticles(any()) } returns emptyList()
        coEvery { articleDao.getAuthorsForArticles(any()) } returns emptyList()
        coEvery { articleDao.getVideosForArticles(any()) } returns emptyList()
        coEvery { firestoreBackupService.batchRestoreArticleRows(any()) } returns emptyMap()
        // A restore page looks its articles up in bulk to skip row reads for local-wins
        // articles; with no local rows every remote article reads its rows.
        coEvery { articleDao.getArticlesWithIds(any()) } returns emptyList()
        manager = FirestoreSyncManager(
            context = context,
            firestore = firestore,
            auth = auth,
            articleDao = articleDao,
            firestoreBackupService = firestoreBackupService,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = TestLocalDataOwner.ownsEveryUid(),
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
        coEvery { articleDao.countArticlesModifiedSince(-1L, any()) } returns 2
        coEvery { articleDao.getArticlesModifiedSinceKeyset(-1L, any(), any(), any(), 50) } returns
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
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns emptyList()

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
        coEvery { articleDao.countArticlesModifiedSince(-1L, any()) } returns 2
        coEvery { articleDao.getArticlesModifiedSinceKeyset(-1L, any(), any(), any(), 50) } returns
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
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns emptyList()

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
        coEvery { articleDao.countArticlesModifiedSince(1000L, any()) } returns 0
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns emptyList()

        manager.syncLocalChanges()

        coVerify(exactly = 1) { firestoreBackupService.getUserMetaSnapshot() }
        // The old two-read pattern must not be invoked.
        coVerify(exactly = 0) { firestoreBackupService.isFirstSync() }
        coVerify(exactly = 0) { firestoreBackupService.getLastSyncTimestamp() }
    }

    /**
     * A deletion is a change: a row deleted after the last sync is pushed through the
     * normal backup path (so Firestore receives its `deletedAt`).
     */
    @Test
    fun `deleted row changed since last sync is pushed`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1000L))
        coEvery { articleDao.countArticlesModifiedSince(1000L, any()) } returns 1
        coEvery { articleDao.getArticlesModifiedSinceKeyset(1000L, any(), any(), any(), 50) } returns
            listOf(Article(itemId = "d1", timeUpdated = 1500L, deletedAt = 1500L))
        coEvery { articleDao.getTagsForArticles(listOf("d1")) } returns emptyList()
        coEvery { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) } returns Result.success(1)
        coEvery { firestoreBackupService.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns emptyList()

        manager.syncLocalChanges()

        coVerify(exactly = 1) {
            firestoreBackupService.backupArticlesPaginated(
                match { it.single().itemId == "d1" && it.single().deletedAt == 1500L },
                any(),
                any(),
            )
        }
        assertTrue(manager.syncStatus.value is SyncStatus.Success)
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
        coEvery { articleDao.countArticlesModifiedSince(1000L, any()) } returns 0

        val stranded = listOf(Article(itemId = "s1"), Article(itemId = "s2"))
        coEvery { articleDao.countArticlesNeverBackedUp() } returns 2
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returnsMany listOf(stranded, emptyList())
        coEvery { firestoreBackupService.backupArticlesPaginated(stranded, any(), any()) } returns Result.success(2)

        manager.syncLocalChanges()

        // The stranded articles were backed up and stamped despite "no local changes".
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(stranded, any(), any()) }
        coVerify(exactly = 1) { articleDao.recordPushResults(match { it.keys.toList() == listOf("s1", "s2") }, emptyList()) }
        assertEquals(SyncStatus.Success("Up to date"), manager.syncStatus.value)
    }

    // ---- Last sync moves only on full success --------------------------------

    /**
     * One article of a chunk fails for a reason of its own: the chunk is retried one
     * article at a time, the good one is stamped, the bad one gets a strike, and
     * "last sync" stays where it was.
     */
    @Test
    fun `partial failure does not advance last sync`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1000L))
        val good = Article(itemId = "p1", timeUpdated = 1500L)
        val poison = Article(itemId = "p2", timeUpdated = 1500L)
        coEvery { articleDao.countArticlesModifiedSince(1000L, any()) } returns 2
        coEvery { articleDao.getArticlesModifiedSinceKeyset(1000L, any(), any(), any(), 50) } returns listOf(good, poison)
        coEvery { articleDao.getTagsForArticles(listOf("p1", "p2")) } returns emptyList()
        val tooBig = FirebaseFirestoreException("document too large", FirebaseFirestoreException.Code.INVALID_ARGUMENT)
        coEvery { firestoreBackupService.backupArticlesPaginated(listOf(good, poison), any(), any()) } returns Result.failure(tooBig)
        coEvery { firestoreBackupService.backupArticlesPaginated(listOf(good), any(), any()) } returns Result.success(1)
        coEvery { firestoreBackupService.backupArticlesPaginated(listOf(poison), any(), any()) } returns Result.failure(tooBig)

        val result = manager.pushLocalChanges()

        assertEquals(SyncRunStatus.PARTIAL_FAILURE, result.status)
        assertEquals(1, result.pushed)
        assertEquals(1, result.failed)
        coVerify(exactly = 1) { articleDao.recordPushResults(match { it.keys.toList() == listOf("p1") }, listOf("p2")) }
        coVerify(exactly = 0) { firestoreBackupService.updateLastSyncTimestamp(any()) }
        // The sweep is skipped after a failure, so nothing else is pushed this run.
        coVerify(exactly = 0) { articleDao.getArticlesNeverBackedUp(any()) }
        assertEquals(0L, manager.lastSyncTime.value)
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
     * A local-wins conflict leaves the local row as it is: nothing is upserted, nothing is
     * stamped and nothing is uploaded here. The push that follows the restore sends it,
     * through the one path that stamps and strikes.
     */
    @Test
    fun `handleRemoteArticleChange does not stamp, upsert or upload on local-wins conflicts`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")

        val remoteArticle = Article(itemId = "r1", timeUpdated = 100)
        val localArticle = Article(itemId = "r1", timeUpdated = 200) // local newer → local wins
        coEvery { articleDao.getArticleById("r1") } returns localArticle
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

        coVerify(exactly = 0) { articleDao.upsertArticle(any()) }
        coVerify(exactly = 0) { firestoreBackupService.backupArticle(any(), any(), any(), any(), any(), any()) }
        coVerify(exactly = 0) { articleDao.recordPushResults(any(), any()) }
    }

    // ---- First sync: a failed remote count ---------------------------------

    @Test
    fun `first sync with a failed remote count stops without recording last sync`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        coEvery { firestoreBackupService.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = true, lastSyncTimestamp = null))
        coEvery { articleDao.countAllArticles() } returns 0
        val offline = FirebaseFirestoreException("offline", FirebaseFirestoreException.Code.UNAVAILABLE)
        coEvery { firestoreBackupService.getRemoteArticleCount() } returns Result.failure(offline)

        val result = manager.fullSync()

        assertEquals(offline, result.interruptedBy)
        assertTrue(manager.syncStatus.value is SyncStatus.Error)
        coVerify(exactly = 0) { firestoreBackupService.updateLastSyncTimestamp(any()) }
        coVerify(exactly = 0) { firestoreBackupService.restoreAllArticlesPaginated(any(), any()) }
    }

    // ---- Inline backup of one article --------------------------------------

    @Test
    fun `backupArticleNow sends tags and rows and stamps the version it sent`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        val article = Article(itemId = "n1", timeUpdated = 700)
        val tag = ArticleTags(itemId = "n1", tag = "read-later", sortId = null, type = null)
        val image = ArticleImages("lead", "n1", "https://example.com/n1.jpg", 10, 20, "", "")
        val author = ArticleAuthors("n1:byline", "n1", "Ada", "", null, null, null, null)
        coEvery { articleDao.getArticleById("n1") } returns article
        coEvery { articleDao.getTagsForArticles(listOf("n1")) } returns listOf(tag)
        coEvery { articleDao.getImagesForArticles(listOf("n1")) } returns listOf(image)
        coEvery { articleDao.getAuthorsForArticles(listOf("n1")) } returns listOf(author)
        val tagsSlot = slot<Map<String, List<ArticleTags>>>()
        val rowsSlot = slot<Map<String, ArticleRows>>()
        coEvery {
            firestoreBackupService.backupArticlesPaginated(listOf(article), capture(tagsSlot), any(), capture(rowsSlot))
        } returns Result.success(1)

        val result = manager.backupArticleNow("n1")

        assertTrue(result.isSuccess)
        assertEquals(listOf(tag), tagsSlot.captured.getValue("n1"))
        assertEquals(listOf(image), rowsSlot.captured.getValue("n1").images)
        assertEquals(listOf(author), rowsSlot.captured.getValue("n1").authors)
        coVerify(exactly = 1) { articleDao.recordPushResults(mapOf("n1" to 700L), emptyList()) }
    }

    @Test
    fun `backupArticleNow uploads nothing when the signed-in user does not own the local data`() = runTest {
        every { auth.currentUser } returns signedInUser("intruder")
        val owner = mockk<com.jayteealao.trails.data.account.LocalDataOwner> {
            every { isOwnedBy("intruder") } returns false
        }
        val guarded = FirestoreSyncManager(
            context = context,
            firestore = firestore,
            auth = auth,
            articleDao = articleDao,
            firestoreBackupService = firestoreBackupService,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = owner,
        )

        val result = guarded.backupArticleNow("n1")

        assertTrue(result.isFailure)
        coVerify(exactly = 0) { articleDao.getArticleById(any()) }
        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any(), any(), any()) }
        coVerify(exactly = 0) { articleDao.recordPushResults(any(), any()) }
    }

    // ---- The sync gate -----------------------------------------------------

    @Test
    fun `a push waits for a wipe that holds the gate`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        val wipeMayFinish = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        coEvery { firestoreBackupService.getUserMetaSnapshot() } coAnswers {
            order += "push-started"
            Result.failure(IllegalStateException("stop here"))
        }

        val wipe = launch {
            manager.runExclusive {
                order += "wipe-started"
                wipeMayFinish.await()
                order += "wipe-finished"
            }
        }
        testScheduler.runCurrent()
        val push = launch { manager.pushLocalChanges() }
        testScheduler.runCurrent()
        assertEquals(listOf("wipe-started"), order)

        wipeMayFinish.complete(Unit)
        wipe.join()
        push.join()

        assertEquals(listOf("wipe-started", "wipe-finished", "push-started"), order)
    }

    @Test
    fun `backupArticleNow does not wait for a held gate and uploads nothing`() = runTest {
        every { auth.currentUser } returns signedInUser("u1")
        val release = CompletableDeferred<Unit>()
        val wipe = launch { manager.runExclusive { release.await() } }
        testScheduler.runCurrent()

        val result = manager.backupArticleNow("n1")

        assertTrue(result.isFailure)
        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any(), any(), any()) }
        release.complete(Unit)
        wipe.join()
    }
}
