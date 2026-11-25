package com.jayteealao.trails.data.local.database

import android.app.Application
import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** A saved link against a real in-memory database: new, in the library, archived or deleted. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class SaveNewArticleTest {

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

    private fun shared(url: String, title: String = "") = Article(
        itemId = "fresh",
        title = title,
        givenTitle = title,
        url = url,
        givenUrl = url,
        normalizedUrl = normalizeUrl(url),
        timeAdded = 9_000,
        timeUpdated = 9_000,
    )

    private val stored = Article(
        itemId = "stored",
        title = "Trees",
        givenTitle = "Trees as given",
        url = "https://example.com/trees",
        givenUrl = "https://short.example/t?utm_source=mail",
        normalizedUrl = "https://example.com/trees",
        excerpt = "The survey",
        favorite = "1",
        timeFavorited = 1_500,
        image = "https://example.com/trees.jpg",
        hasImage = true,
        text = "Forty volunteers",
        textSource = "readability",
        resolved = 2,
        timeAdded = 1_000,
        timeUpdated = 2_000,
    )

    @Test
    fun aNewLinkIsStored() = runTest {
        val article = shared("https://example.com/new", title = "New")

        assertEquals(SavedArticle("fresh", alreadySaved = false), dao.upsertNewArticle(article))
        assertEquals(article, dao.getArticleById("fresh"))
    }

    @Test
    fun aLinkInTheLibraryIsAlreadySaved_andKeepsEverything() = runTest {
        dao.upsertArticle(stored)

        val saved = dao.upsertNewArticle(shared("https://example.com/trees?utm_source=feed", title = "Another"))

        assertEquals(SavedArticle("stored", alreadySaved = true), saved)
        assertEquals(stored.copy(timeUpdated = 9_000), dao.getArticleById("stored"))
        assertNull(dao.getArticleById("fresh"))
    }

    @Test
    fun anArchivedLinkIsAlreadySaved_andIsBackInTheList() = runTest {
        dao.upsertArticle(stored.copy(archivedAt = 3_000))

        assertEquals(SavedArticle("stored", true), dao.upsertNewArticle(shared("https://example.com/trees")))
        assertEquals(stored.copy(timeUpdated = 9_000), dao.getArticleById("stored"))
    }

    @Test
    fun aDeletedLinkIsANewSave_andItsTimeIsLaterThanItsDeletion() = runTest {
        dao.upsertArticle(stored.copy(deletedAt = 20_000, timeUpdated = 20_000))

        assertEquals(SavedArticle("stored", false), dao.upsertNewArticle(shared("https://example.com/trees")))
        assertEquals(stored.copy(timeUpdated = 20_001), dao.getArticleById("stored"))
    }

    @Test
    fun aLinkThatRedirected_isFoundByTheAddressThatWasShared() = runTest {
        dao.upsertArticle(stored)

        val saved = dao.upsertNewArticle(shared("https://short.example/t?utm_source=mail"))

        assertEquals(SavedArticle("stored", true), saved)
    }
}
