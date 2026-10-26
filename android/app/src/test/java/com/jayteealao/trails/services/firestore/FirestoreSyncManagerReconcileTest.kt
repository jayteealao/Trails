package com.jayteealao.trails.services.firestore

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
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
import org.junit.Before
import org.junit.Test
import com.jayteealao.trails.testing.TestLocalDataOwner

/**
 * Tests for [FirestoreSyncManager.reconcileNeverBackedUpArticles] — the Class-B
 * sweep that backs up articles whose [Article.backedUpAt] is NULL.
 *
 * Verifies:
 * - Never-backed-up articles are passed to [FirestoreBackupService.backupArticlesPaginated].
 * - [ArticleDao.recordPushResults] stamps every article of a chunk that backs up.
 * - A chunk failure retries its articles one by one, strikes the ones that fail,
 *   stops the sweep and does not crash.
 * - When no never-backed-up articles exist the sweep is a no-op.
 * - Unauthenticated user is a no-op.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirestoreSyncManagerReconcileTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var firestoreBackupService: FirestoreBackupService

    private lateinit var manager: FirestoreSyncManager

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        // The sweep logs its backlog count at start (strict mocks — stub here once;
        // individual tests override when the count matters).
        coEvery { articleDao.countArticlesNeverBackedUp() } returns 0
        // Every push chunk reads the articles' image and author rows; none here.
        coEvery { articleDao.getImagesForArticles(any()) } returns emptyList()
        coEvery { articleDao.getAuthorsForArticles(any()) } returns emptyList()
        coEvery { articleDao.getVideosForArticles(any()) } returns emptyList()
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

    private fun article(id: String) = Article(itemId = id, backedUpAt = null)

    // ── unauthenticated ──────────────────────────────────────────────────────

    @Test
    fun `reconcile is a no-op when user is not authenticated`() = runTest {
        every { auth.currentUser } returns null

        manager.reconcileNeverBackedUpArticles()

        // DAO and backup service must not be touched
        coVerify(exactly = 0) { articleDao.getArticlesNeverBackedUp(any()) }
        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) }
    }

    // ── no never-backed-up articles ──────────────────────────────────────────

    @Test
    fun `reconcile is a no-op when all articles have backed_up_at set`() = runTest {
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns emptyList()

        manager.reconcileNeverBackedUpArticles()

        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) }
        coVerify(exactly = 0) { articleDao.recordPushResults(any(), any(), any()) }
    }

    // ── single page of never-backed-up articles ──────────────────────────────

    @Test
    fun `reconcile backs up never-backed-up articles and stamps backed_up_at`() = runTest {
        val articles = listOf(article("art1"), article("art2"), article("art3"))
        every { auth.currentUser } returns signedInUser()
        // Sweep always queries at offset 0. Stamping rows removes them from the
        // predicate, so the second call at offset 0 returns empty.
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returnsMany listOf(articles, emptyList())
        coEvery { firestoreBackupService.backupArticlesPaginated(articles, any(), any()) } returns Result.success(3)
        coEvery { articleDao.recordPushResults(any(), any(), any()) } returns Unit

        manager.reconcileNeverBackedUpArticles()

        // The chunk's articles are stamped together, exactly once, with no failure.
        coVerify(exactly = 1) { articleDao.recordPushResults(listOf("art1", "art2", "art3"), emptyList(), any()) }
        coVerify(exactly = 1) { articleDao.recordPushResults(any(), any(), any()) }
    }

    // ── multi-page sweep ─────────────────────────────────────────────────────

    @Test
    fun `reconcile processes multiple pages until empty`() = runTest {
        // Two consecutive FULL pages (20 + 20) followed by a partial page: a backlog
        // larger than two full chunks is exactly the shape that made the old
        // chunk-size-equality stall guard misfire (two full pages of *different*
        // rows both have size 20) and strand everything after the first chunk.
        val page1 = (1..20).map { article("art$it") }
        val page2 = (21..40).map { article("art$it") }
        val page3 = (41..45).map { article("art$it") }
        every { auth.currentUser } returns signedInUser()
        // Sweep always queries at offset 0. Each successful stamp removes rows from
        // the predicate, so the next call at offset 0 returns the next unswept batch.
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returnsMany listOf(page1, page2, page3, emptyList())
        coEvery { firestoreBackupService.backupArticlesPaginated(page1, any(), any()) } returns Result.success(20)
        coEvery { firestoreBackupService.backupArticlesPaginated(page2, any(), any()) } returns Result.success(20)
        coEvery { firestoreBackupService.backupArticlesPaginated(page3, any(), any()) } returns Result.success(5)
        coEvery { articleDao.recordPushResults(any(), any(), any()) } returns Unit

        manager.reconcileNeverBackedUpArticles()

        // 45 articles total — verify backup called for all three pages.
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(page1, any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(page2, any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(page3, any(), any()) }
        // backed_up_at stamped for all 45 articles, one record per page.
        listOf(page1, page2, page3).forEach { page ->
            coVerify(exactly = 1) { articleDao.recordPushResults(page.map { it.itemId }, emptyList(), any()) }
        }
        coVerify(exactly = 3) { articleDao.recordPushResults(any(), any(), any()) }
    }

    // ── genuine stall terminates ──────────────────────────────────────────────

    @Test
    fun `reconcile terminates when the same rows keep returning`() = runTest {
        // Stamping is a silent no-op here, so the identical page comes back on every
        // fetch — a genuine stall. The row-identity guard must break the loop on the
        // second fetch instead of spinning forever.
        val samePage = (1..20).map { article("art$it") }
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.countArticlesNeverBackedUp() } returns 20
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns samePage
        coEvery { firestoreBackupService.backupArticlesPaginated(samePage, any(), any()) } returns Result.success(20)
        coEvery { articleDao.recordPushResults(any(), any(), any()) } returns Unit

        manager.reconcileNeverBackedUpArticles()

        // First fetch proceeds (backup + stamp attempt); second fetch sees the same
        // ids and stops. No third fetch, no second backup.
        coVerify(exactly = 2) { articleDao.getArticlesNeverBackedUp(any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(samePage, any(), any()) }
    }

    // ── backup failure stops sweep ────────────────────────────────────────────

    @Test
    fun `reconcile stops sweep and does not crash on backup failure`() = runTest {
        val articles = listOf(article("art1"), article("art2"))
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.getArticlesNeverBackedUp(any()) } returns articles
        coEvery { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) } returns Result.failure(Exception("network error"))
        coEvery { articleDao.recordPushResults(any(), any(), any()) } returns Unit

        // Must not throw — a failed backup is a deferral, not a crash.
        manager.reconcileNeverBackedUpArticles()

        // The failure is the articles' own, so each is retried alone once (1 chunk call +
        // 2 single calls), nothing is stamped and each gets one strike.
        coVerify(exactly = 3) { firestoreBackupService.backupArticlesPaginated(any(), any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(listOf(articles[0]), any(), any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(listOf(articles[1]), any(), any()) }
        coVerify(exactly = 1) { articleDao.recordPushResults(emptyList(), listOf("art1", "art2"), any()) }
        coVerify(exactly = 1) { articleDao.recordPushResults(any(), any(), any()) }
        // Second page must not be fetched after the first failed (only one call at offset 0).
        coVerify(exactly = 1) { articleDao.getArticlesNeverBackedUp(any()) }
    }
}
