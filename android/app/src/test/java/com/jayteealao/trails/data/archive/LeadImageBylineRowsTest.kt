package com.jayteealao.trails.data.archive

import android.app.Application
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArchiveUrlService
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.Runs
import io.mockk.spyk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
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
 * Warg metadata becomes the article's lead-image row and byline row, through the
 * real [ArchiveService.applyWargMetadata] and a real in-memory database on the
 * bundled engine. Firestore is a fake: the user doc names the shared article
 * through `canonicalId`, the shared doc carries a fixture `metadata` map.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class LeadImageBylineRowsTest {

    private val lead = "https://example.com/lead.jpg"

    private lateinit var db: AppDatabase
    private lateinit var dao: ArticleDao
    private lateinit var firestore: FirebaseFirestore
    private lateinit var articlesCollection: CollectionReference
    private lateinit var userArticleDoc: DocumentReference
    private lateinit var a1SharedDoc: DocumentReference
    private lateinit var shared1Doc: DocumentReference
    private lateinit var service: ArchiveService

    @Before
    fun setUp() {
        db = JvmRoomDatabase.create(RuntimeEnvironment.getApplication())
        dao = db.articleDao()

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        val auth = mockk<FirebaseAuth>()
        every { auth.currentUser } returns user

        firestore = mockk()
        val usersCollection = mockk<CollectionReference>()
        val userDoc = mockk<DocumentReference>()
        val userArticles = mockk<CollectionReference>()
        userArticleDoc = mockk()
        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document("u1") } returns userDoc
        every { userDoc.collection("articles") } returns userArticles
        every { userArticles.document("a1") } returns userArticleDoc

        articlesCollection = mockk()
        a1SharedDoc = mockk()
        shared1Doc = mockk()
        every { firestore.collection("articles") } returns articlesCollection
        every { articlesCollection.document("a1") } returns a1SharedDoc
        every { articlesCollection.document("shared1") } returns shared1Doc

        service = ArchiveService(
            firestore = firestore,
            auth = auth,
            okHttpClient = mockk<OkHttpClient>(relaxed = true),
            archiveUrlService = mockk<ArchiveUrlService>(relaxed = true),
            remoteConfig = mockk<FirebaseRemoteConfig>(relaxed = true),
            localArchiveDao = mockk<LocalArchiveDao>(relaxed = true),
            articleDao = dao,
            application = RuntimeEnvironment.getApplication(),
            ioDispatcher = UnconfinedTestDispatcher(),
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun article(image: String? = null, deletedAt: Long? = null) = Article(
        itemId = "a1",
        title = "Article a1",
        url = "https://example.com/a1",
        timeAdded = 1_000,
        timeUpdated = 2_000,
        image = image,
        deletedAt = deletedAt,
    )

    private fun userSnapshot(canonicalId: String?): DocumentSnapshot {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.get("canonicalId") } returns canonicalId
        return snapshot
    }

    private fun sharedSnapshot(metadata: Map<String, Any?>?): DocumentSnapshot {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.get("metadata") } returns metadata
        return snapshot
    }

    private fun fixtureMetadata(leadImage: String? = lead): Map<String, Any?> = mapOf(
        "title" to "T",
        "byline" to "Jo Writer",
        "word_count" to 120L,
        "lead_image" to leadImage,
    )

    /** The user doc names shared1, which carries [metadata]. */
    private fun linkToShared(metadata: Map<String, Any?>?) {
        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot("shared1"))
        every { shared1Doc.get() } returns Tasks.forResult(sharedSnapshot(metadata))
    }

    private val expectedLeadRow = ArticleImages("lead", "a1", "https://example.com/lead.jpg", 0, 0, "", "")

    @Test
    fun runTwice_storesExactlyOneLeadImageRowAndOneBylineRow() = runTest {
        dao.upsertArticles(listOf(article()))
        linkToShared(fixtureMetadata())

        service.applyWargMetadata("a1")
        val afterFirst = dao.getArticleById("a1")!!
        service.applyWargMetadata("a1")
        val afterSecond = dao.getArticleById("a1")!!

        assertEquals(listOf(expectedLeadRow), dao.getImagesForArticles(listOf("a1")))
        val authors = dao.getAuthorsForArticles(listOf("a1"))
        assertEquals(1, authors.size)
        assertEquals("a1:byline", authors.single().authorId)
        assertEquals("Jo Writer", authors.single().name)
        assertEquals(lead, afterSecond.image)
        assertTrue("the row write raises timeUpdated", afterFirst.timeUpdated > 2_000)
        assertEquals("a repeat run writes nothing", afterFirst.timeUpdated, afterSecond.timeUpdated)
        assertTrue(dao.getImagesForArticles(listOf("shared1")).isEmpty())
        assertTrue(dao.getAuthorsForArticles(listOf("shared1")).isEmpty())
        verify(exactly = 0) { a1SharedDoc.get() }
    }

    @Test
    fun neverOpenedArticle_backgroundPassStoresItsRows_once() = runTest {
        val now = 10_000_000_000L
        dao.upsertArticles(listOf(article().copy(timeAdded = now - 60_000)))
        linkToShared(fixtureMetadata())

        assertEquals(1, service.applyMissingWargMetadata(now = now))
        assertEquals(listOf(expectedLeadRow), dao.getImagesForArticles(listOf("a1")))
        assertEquals(listOf("a1:byline"), dao.getAuthorsForArticles(listOf("a1")).map { it.authorId })
        assertEquals(lead, dao.getArticleById("a1")!!.image)

        // The article now has its rows, so a later pass does not read its metadata again.
        assertEquals(0, service.applyMissingWargMetadata(now = now + WARG_METADATA_WINDOW_MS / 2))
        verify(exactly = 1) { shared1Doc.get() }
    }

    @Test
    fun backgroundPass_waitsLongerBetweenChecksUntilWargHasArchived() = runTest {
        val now = 10_000_000_000L
        dao.upsertArticles(listOf(article().copy(timeAdded = now - 60_000)))
        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot("shared1"))
        val notYet = mockk<DocumentSnapshot>().also { every { it.exists() } returns false }
        every { shared1Doc.get() } returns Tasks.forResult(notYet)

        assertEquals(0, service.applyMissingWargMetadata(now = now))
        assertEquals(0, service.applyMissingWargMetadata(now = now + 60_000))
        verify(exactly = 1) { shared1Doc.get() }

        // Warg has archived it by the second check, 15 minutes later.
        every { shared1Doc.get() } returns Tasks.forResult(sharedSnapshot(fixtureMetadata()))
        assertEquals(1, service.applyMissingWargMetadata(now = now + WARG_METADATA_FIRST_WAIT_MS))
        assertEquals(listOf(expectedLeadRow), dao.getImagesForArticles(listOf("a1")))
    }

    @Test
    fun backgroundPass_skipsArticlesSavedBeforeItsWindow() = runTest {
        val now = 10_000_000_000L
        dao.upsertArticles(listOf(article().copy(timeAdded = now - WARG_METADATA_WINDOW_MS - 1)))
        linkToShared(fixtureMetadata())

        assertEquals(0, service.applyMissingWargMetadata(now = now))
        verify(exactly = 0) { shared1Doc.get() }
    }

    @Test
    fun checkSchedule_backsOffAndStops() {
        assertTrue(wargMetadataCheckDue(checks = 0, lastCheckAt = 0, now = 0))
        assertEquals(false, wargMetadataCheckDue(checks = 1, lastCheckAt = 0, now = WARG_METADATA_FIRST_WAIT_MS - 1))
        assertTrue(wargMetadataCheckDue(checks = 1, lastCheckAt = 0, now = WARG_METADATA_FIRST_WAIT_MS))
        assertEquals(false, wargMetadataCheckDue(checks = 2, lastCheckAt = 0, now = WARG_METADATA_FIRST_WAIT_MS))
        assertTrue(wargMetadataCheckDue(checks = 2, lastCheckAt = 0, now = 4 * WARG_METADATA_FIRST_WAIT_MS))
        assertEquals(false, wargMetadataCheckDue(checks = WARG_METADATA_MAX_CHECKS, lastCheckAt = 0, now = Long.MAX_VALUE))
    }

    @Test
    fun noCanonicalId_readsTheArticlesOwnSharedDoc() = runTest {
        dao.upsertArticles(listOf(article()))
        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot(null))
        every { a1SharedDoc.get() } returns Tasks.forResult(sharedSnapshot(fixtureMetadata()))

        service.applyWargMetadata("a1")

        assertEquals(listOf(expectedLeadRow), dao.getImagesForArticles(listOf("a1")))
        assertEquals(listOf("a1:byline"), dao.getAuthorsForArticles(listOf("a1")).map { it.authorId })
        assertEquals(lead, dao.getArticleById("a1")!!.image)
        verify(exactly = 0) { shared1Doc.get() }
    }

    @Test
    fun noLeadImage_usesTheArchivedScreenshot() = runTest {
        dao.upsertArticles(listOf(article()))
        linkToShared(fixtureMetadata(leadImage = null))
        val spy = spyk(service)
        coEvery { spy.applyScreenshotAsImage("a1") } just Runs

        spy.applyWargMetadata("a1")

        coVerify(exactly = 1) { spy.applyScreenshotAsImage("a1") }
        assertTrue(dao.getImagesForArticles(listOf("a1")).isEmpty())
        assertEquals(listOf("a1:byline"), dao.getAuthorsForArticles(listOf("a1")).map { it.authorId })
    }

    @Test
    fun leadImage_replacesAnEarlierScreenshotAndSkipsTheScreenshot() = runTest {
        dao.upsertArticles(listOf(article(image = "data:image/jpeg;base64,AAA")))
        linkToShared(fixtureMetadata())
        val spy = spyk(service)
        coEvery { spy.applyScreenshotAsImage(any()) } just Runs

        spy.applyWargMetadata("a1")

        assertEquals(lead, dao.getArticleById("a1")!!.image)
        coVerify(exactly = 0) { spy.applyScreenshotAsImage(any()) }
    }

    @Test
    fun deletedArticle_readsNothingAndWritesNothing() = runTest {
        dao.upsertArticles(listOf(article(deletedAt = 3_000)))
        linkToShared(fixtureMetadata())

        service.applyWargMetadata("a1")

        verify(exactly = 0) { articlesCollection.document(any()) }
        assertTrue(dao.getImagesForArticles(listOf("a1")).isEmpty())
        assertTrue(dao.getAuthorsForArticles(listOf("a1")).isEmpty())
        assertEquals(2_000, dao.getArticleById("a1")!!.timeUpdated)
    }

    @Test
    fun noMetadata_writesNoRowAndLeavesTheImage() = runTest {
        dao.upsertArticles(listOf(article(image = "https://example.com/unfurl.jpg")))
        linkToShared(null)

        service.applyWargMetadata("a1")

        assertTrue(dao.getImagesForArticles(listOf("a1")).isEmpty())
        assertTrue(dao.getAuthorsForArticles(listOf("a1")).isEmpty())
        val stored = dao.getArticleById("a1")!!
        assertEquals("https://example.com/unfurl.jpg", stored.image)
        assertEquals(2_000, stored.timeUpdated)
    }

    @Test
    fun importedRows_getNoNewRowAndKeepTheImage() = runTest {
        val importedImage = ArticleImages("1", "a1", "https://example.com/imported.jpg", 100, 50, "", "")
        val importedAuthor = ArticleAuthors("77", "a1", "Imported Author", "", null, null, null, null)
        dao.upsertArticles(listOf(article(image = importedImage.src)))
        dao.insertArticleRows(listOf(importedImage), listOf(importedAuthor))
        linkToShared(fixtureMetadata())

        service.applyWargMetadata("a1")

        assertEquals(listOf(importedImage), dao.getImagesForArticles(listOf("a1")))
        assertEquals(listOf(importedAuthor), dao.getAuthorsForArticles(listOf("a1")))
        val stored = dao.getArticleById("a1")!!
        assertEquals(importedImage.src, stored.image)
        assertEquals(2_000, stored.timeUpdated)
    }

    @Test
    fun missingArticle_writesNothing() = runTest {
        linkToShared(fixtureMetadata())

        service.applyWargMetadata("a1")

        assertNull(dao.getArticleById("a1"))
        assertTrue(dao.getImagesForArticles(listOf("a1")).isEmpty())
        assertTrue(dao.getAuthorsForArticles(listOf("a1")).isEmpty())
        verify(exactly = 0) { articlesCollection.document(any()) }
    }
}
