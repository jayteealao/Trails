package com.jayteealao.trails.services.firestore

import android.app.Application
import android.content.Context
import androidx.paging.PagingSource
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.jayteealao.trails.testing.TestLocalDataOwner

/**
 * A deletion survives the round trip through the real database: the deleted row is
 * selected for the push, and after a reinstall (a fresh, empty database) a restored
 * tombstone lands as deleted and stays out of the library list.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class DeletionRoundTripTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao
    private lateinit var manager: FirestoreSyncManager

    @Before
    fun setUp() {
        db = JvmRoomDatabase.create(RuntimeEnvironment.getApplication())
        dao = db.articleDao()
        val backupService = mockk<FirestoreBackupService>()
        coEvery { backupService.batchRestoreArticleTags(any()) } returns emptyMap()
        coEvery { backupService.batchRestoreArticleRows(any()) } returns emptyMap()
        manager = FirestoreSyncManager(
            context = mockk<Context>(relaxed = true),
            firestore = mockk<FirebaseFirestore>(relaxed = true),
            auth = mockk<FirebaseAuth>(relaxed = true),
            articleDao = dao,
            firestoreBackupService = backupService,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = TestLocalDataOwner.ownsEveryUid(),
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun article(id: String, title: String, timeUpdated: Long = 10L, deletedAt: Long? = null) =
        Article(
            itemId = id,
            title = title,
            url = "https://example.com/$id",
            timeAdded = timeUpdated,
            timeUpdated = timeUpdated,
            deletedAt = deletedAt,
        )

    private suspend fun libraryIds(): List<String> {
        val result = dao.getArticlesWithTags().load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 50, placeholdersEnabled = false),
        )
        return (result as PagingSource.LoadResult.Page).data.map { it.itemId }
    }

    @Test
    fun `a deleted row is selected for the push`() = runTest {
        dao.upsertArticles(listOf(article("a1", "Roses"), article("a2", "Apples"), article("a3", "Pears")))

        dao.updateDeleted("a2", 500L)

        assertEquals(3, dao.countArticlesModifiedSince(0L, Long.MAX_VALUE))
        val pushed = dao.getArticlesModifiedSinceKeyset(0L, Long.MAX_VALUE, 0L, "", 50).associateBy { it.itemId }
        assertEquals(setOf("a1", "a2", "a3"), pushed.keys)
        assertEquals(500L, pushed.getValue("a2").deletedAt)
    }

    @Test
    fun `after a reinstall a restored tombstone stays deleted and out of the library`() = runTest {
        val live = article("live", "Kept article", timeUpdated = 100L)
        val tombstone = article("gone", "Deleted article", timeUpdated = 200L, deletedAt = 200L)

        manager.applyRemoteArticles(listOf(live, tombstone))

        assertNotNull(dao.getArticleById("gone")?.deletedAt)
        assertEquals(1, dao.countAllArticles())
        assertEquals(listOf("live"), libraryIds())
    }

    @Test
    fun `a newer remote tombstone deletes the local live row`() = runTest {
        dao.upsertArticles(listOf(article("x", "Shared article", timeUpdated = 100L)))

        manager.applyRemoteArticles(listOf(article("x", "Shared article", timeUpdated = 200L, deletedAt = 200L)))

        assertEquals(200L, dao.getArticleById("x")?.deletedAt)
        assertTrue(libraryIds().isEmpty())
    }
}
