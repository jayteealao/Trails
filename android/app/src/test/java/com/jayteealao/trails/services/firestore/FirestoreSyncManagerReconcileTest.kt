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

/**
 * Tests for [FirestoreSyncManager.reconcileNeverBackedUpArticles] — the Class-B
 * sweep that backs up articles whose [Article.backedUpAt] is NULL.
 *
 * Verifies:
 * - Never-backed-up articles are passed to [FirestoreBackupService.backupArticlesPaginated].
 * - [ArticleDao.updateBackedUpAt] is stamped for each article on success.
 * - A backup failure stops the sweep and does not crash.
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

    private fun article(id: String) = Article(itemId = id, backedUpAt = null)

    // ── unauthenticated ──────────────────────────────────────────────────────

    @Test
    fun `reconcile is a no-op when user is not authenticated`() = runTest {
        every { auth.currentUser } returns null

        manager.reconcileNeverBackedUpArticles()

        // DAO and backup service must not be touched
        coVerify(exactly = 0) { articleDao.getArticlesNeverBackedUp(any(), any()) }
        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any()) }
    }

    // ── no never-backed-up articles ──────────────────────────────────────────

    @Test
    fun `reconcile is a no-op when all articles have backed_up_at set`() = runTest {
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.getArticlesNeverBackedUp(any(), any()) } returns emptyList()

        manager.reconcileNeverBackedUpArticles()

        coVerify(exactly = 0) { firestoreBackupService.backupArticlesPaginated(any(), any()) }
        coVerify(exactly = 0) { articleDao.updateBackedUpAt(any(), any()) }
    }

    // ── single page of never-backed-up articles ──────────────────────────────

    @Test
    fun `reconcile backs up never-backed-up articles and stamps backed_up_at`() = runTest {
        val articles = listOf(article("art1"), article("art2"), article("art3"))
        every { auth.currentUser } returns signedInUser()
        // First page returns 3 articles; second page returns empty (end of sweep).
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 0) } returns articles
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 3) } returns emptyList()
        coEvery { firestoreBackupService.backupArticlesPaginated(articles, any()) } returns Result.success(3)
        coEvery { articleDao.updateBackedUpAt(any(), any()) } returns Unit

        manager.reconcileNeverBackedUpArticles()

        // Each article gets its backed_up_at stamped exactly once.
        coVerify(exactly = 1) { articleDao.updateBackedUpAt("art1", any()) }
        coVerify(exactly = 1) { articleDao.updateBackedUpAt("art2", any()) }
        coVerify(exactly = 1) { articleDao.updateBackedUpAt("art3", any()) }
    }

    // ── multi-page sweep ─────────────────────────────────────────────────────

    @Test
    fun `reconcile processes multiple pages until empty`() = runTest {
        val page1 = (1..20).map { article("art$it") }
        val page2 = (21..25).map { article("art$it") }
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 0) } returns page1
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 20) } returns page2
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 25) } returns emptyList()
        coEvery { firestoreBackupService.backupArticlesPaginated(page1, any()) } returns Result.success(20)
        coEvery { firestoreBackupService.backupArticlesPaginated(page2, any()) } returns Result.success(5)
        coEvery { articleDao.updateBackedUpAt(any(), any()) } returns Unit

        manager.reconcileNeverBackedUpArticles()

        // 25 articles total — verify backup called for both pages.
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(page1, any()) }
        coVerify(exactly = 1) { firestoreBackupService.backupArticlesPaginated(page2, any()) }
        // backed_up_at stamped for all 25 articles.
        (1..25).forEach { i ->
            coVerify(exactly = 1) { articleDao.updateBackedUpAt("art$i", any()) }
        }
    }

    // ── backup failure stops sweep ────────────────────────────────────────────

    @Test
    fun `reconcile stops sweep and does not crash on backup failure`() = runTest {
        val articles = listOf(article("art1"), article("art2"))
        every { auth.currentUser } returns signedInUser()
        coEvery { articleDao.getArticlesNeverBackedUp(any(), 0) } returns articles
        coEvery { firestoreBackupService.backupArticlesPaginated(any(), any()) } returns Result.failure(Exception("network error"))
        coEvery { articleDao.updateBackedUpAt(any(), any()) } returns Unit

        // Must not throw — a failed backup is a deferral, not a crash.
        manager.reconcileNeverBackedUpArticles()

        // backed_up_at must NOT be stamped if the backup failed.
        coVerify(exactly = 0) { articleDao.updateBackedUpAt(any(), any()) }
        // Second page must not be fetched after the first failed.
        coVerify(exactly = 0) { articleDao.getArticlesNeverBackedUp(any(), articles.size) }
    }
}
