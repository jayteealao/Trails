package com.jayteealao.trails.services.firestore

import android.app.Application
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.testing.JvmRoomDatabase
import com.jayteealao.trails.testing.MapBackedFirestore
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.jayteealao.trails.testing.TestLocalDataOwner

/**
 * An article's image and author rows survive a backup and a restore into an empty
 * database: the real backup service writes them to a map-backed Firestore, the real
 * sync manager's apply step reads them back, and a real database stores them. The push
 * path sends each article's rows with it and sends nothing for an article without rows.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ImageAuthorSyncRoundTripTest {

    private val databases = mutableListOf<AppDatabase>()

    @After
    fun tearDown() {
        databases.forEach { it.close() }
    }

    private fun newDao(): ArticleDao =
        JvmRoomDatabase.create(RuntimeEnvironment.getApplication()).also { databases += it }.articleDao()

    private fun manager(dao: ArticleDao, service: FirestoreBackupService, fake: MapBackedFirestore? = null) =
        FirestoreSyncManager(
            context = RuntimeEnvironment.getApplication(),
            firestore = fake?.firestore ?: mockk<FirebaseFirestore>(relaxed = true),
            auth = fake?.auth ?: MapBackedFirestore().auth,
            articleDao = dao,
            firestoreBackupService = service,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = TestLocalDataOwner.ownsEveryUid(),
        )

    private val a1 = Article(
        itemId = "a1",
        title = "Article a1",
        url = "https://example.com/a1",
        timeAdded = 2_000,
        timeUpdated = 2_000,
    )

    private val images = listOf(
        ArticleImages("1", "a1", "https://example.com/a1/lead.jpg", 1200, 630, "Photo credit", "Lead"),
        ArticleImages("2", "a1", "https://example.com/a1/inline.png", 640, 480, "", ""),
    )

    private val authors = listOf(
        ArticleAuthors("a1:byline", "a1", "Ada Writer", "https://example.com/ada", "example.com", null, "Bio", "@ada"),
    )

    @Test
    fun backupThenRestoreIntoAnEmptyDatabase_keepsTheImageAndAuthorRows() = runTest {
        val fake = MapBackedFirestore()
        val service = FirestoreBackupService(fake.firestore, fake.auth)

        val backup = service.backupArticlesPaginated(listOf(a1), emptyMap(), rowsByArticleId = groupRows(images, authors))

        assertEquals(Result.success(1), backup)
        assertEquals(2, fake.docsUnder("users/u1/articles/a1/images").size)
        assertEquals(1, fake.docsUnder("users/u1/articles/a1/authors").size)

        val dao = newDao()
        val failed = manager(dao, service, fake).applyRemoteArticles(listOf(a1))

        assertEquals(0, failed)
        assertTrue(dao.getArticleById("a1") != null)
        assertEquals(images.toSet(), dao.getImagesForArticles(listOf("a1")).toSet())
        assertEquals(2, dao.getImagesForArticles(listOf("a1")).size)
        assertEquals(authors, dao.getAuthorsForArticles(listOf("a1")))
    }

    @Test
    fun backupThenRestoreIntoAnEmptyDatabase_keepsTheVideoRows() = runTest {
        val fake = MapBackedFirestore()
        val service = FirestoreBackupService(fake.firestore, fake.auth)
        val videos = listOf(
            ArticleVideos("1", "a1", "https://example.com/a1/clip.mp4", 640, 360, "mp4", "clip1", 42, "https://example.com/a1/poster.jpg"),
        )

        val backup = service.backupArticlesPaginated(
            listOf(a1),
            emptyMap(),
            rowsByArticleId = groupRows(emptyList(), emptyList(), videos),
        )

        assertEquals(Result.success(1), backup)
        assertEquals(1, fake.docsUnder("users/u1/articles/a1/videos").size)

        val dao = newDao()
        assertEquals(0, manager(dao, service, fake).applyRemoteArticles(listOf(a1)))
        assertEquals(videos, dao.getVideosForArticles(listOf("a1")))
    }

    @Test
    fun restorePage_readsRowsOnlyForArticlesTheRemoteSideWrites() = runTest {
        val dao = newDao()
        val localNewer = a1.copy(itemId = "local", url = "https://example.com/local", timeUpdated = 9_000)
        val remoteNewer = a1.copy(itemId = "remote", url = "https://example.com/remote", timeUpdated = 1_000)
        dao.upsertArticles(listOf(localNewer, remoteNewer))
        val service = mockk<FirestoreBackupService>(relaxed = true)
        val rowReads = mutableListOf<List<String>>()
        coEvery { service.batchRestoreArticleTags(any()) } returns emptyMap()
        coEvery { service.batchRestoreArticleRows(any()) } answers {
            rowReads += firstArg<List<String>>()
            emptyMap()
        }

        manager(dao, service).applyRemoteArticles(
            listOf(
                localNewer.copy(timeUpdated = 5_000),
                remoteNewer.copy(timeUpdated = 5_000),
                a1.copy(itemId = "new", url = "https://example.com/new"),
            )
        )

        assertEquals(listOf(listOf("remote", "new")), rowReads)
    }

    @Test
    fun push_sendsEachArticlesRows_andNothingForAnArticleWithoutRows() = runTest {
        val dao = newDao()
        val a2 = a1.copy(itemId = "a2", url = "https://example.com/a2")
        dao.upsertArticles(listOf(a1, a2))
        dao.insertArticleRows(images, authors)

        val sentRows = mutableListOf<Map<String, ArticleRows>>()
        val service = mockk<FirestoreBackupService>()
        coEvery { service.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1_000L))
        coEvery { service.updateLastSyncTimestamp(any()) } returns Result.success(Unit)
        coEvery { service.backupArticlesPaginated(any(), any(), any(), any()) } answers {
            sentRows += arg<Map<String, ArticleRows>>(3)
            Result.success(firstArg<List<Article>>().size)
        }

        val result = manager(dao, service).pushLocalChanges()

        assertEquals(2, result.pushed)
        val rows = sentRows.reduce { acc, map -> acc + map }
        assertEquals(setOf("a1"), rows.keys)
        assertEquals(images.toSet(), rows.getValue("a1").images.toSet())
        assertEquals(authors, rows.getValue("a1").authors)
        assertFalse("a2" in rows)
    }
}
