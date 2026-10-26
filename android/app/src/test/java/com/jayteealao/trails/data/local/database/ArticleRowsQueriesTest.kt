package com.jayteealao.trails.data.local.database

import android.app.Application
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The image and author row queries against a real in-memory database on the bundled
 * SQLite engine: the readers return only the asked articles' rows, the restore insert
 * upserts and leaves the article alone, and rows added on this device bring the article
 * back into the next push.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ArticleRowsQueriesTest {

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

    private fun article(itemId: String, timeUpdated: Long = 2_000) = Article(
        itemId = itemId,
        title = "Article $itemId",
        url = "https://example.com/$itemId",
        timeAdded = 1_000,
        timeUpdated = timeUpdated,
    )

    private fun image(itemId: String, imageId: String = "1") = ArticleImages(
        imageId = imageId,
        itemId = itemId,
        src = "https://example.com/$itemId/$imageId.jpg",
        width = 100,
        height = 50,
        credit = "",
        caption = "",
    )

    private fun author(itemId: String) = ArticleAuthors(
        authorId = "$itemId:author",
        itemId = itemId,
        name = "Author of $itemId",
        url = "",
        domain = null,
        image = null,
        bio = null,
        twitter = null,
    )

    @Test
    fun readers_returnOnlyTheAskedArticlesRows() = runTest {
        dao.upsertArticles(listOf(article("a"), article("b"), article("c")))
        dao.insertArticleRows(
            listOf(image("a"), image("a", "2"), image("b"), image("c")),
            listOf(author("a"), author("b"), author("c")),
        )

        val images = dao.getImagesForArticles(listOf("a", "b"))
        val authors = dao.getAuthorsForArticles(listOf("a", "b"))

        assertEquals(setOf(image("a"), image("a", "2"), image("b")), images.toSet())
        assertEquals(3, images.size)
        assertEquals(setOf(author("a"), author("b")), authors.toSet())
        assertEquals(2, authors.size)
    }

    @Test
    fun insertArticleRows_twice_keepsOneCopy() = runTest {
        dao.upsertArticles(listOf(article("a")))

        repeat(2) { dao.insertArticleRows(listOf(image("a")), listOf(author("a"))) }

        assertEquals(listOf(image("a")), dao.getImagesForArticles(listOf("a")))
        assertEquals(listOf(author("a")), dao.getAuthorsForArticles(listOf("a")))
    }

    @Test
    fun addLocalArticleRows_storesRowsAndBringsTheArticleBackIntoThePush() = runTest {
        dao.upsertArticles(listOf(article("a", timeUpdated = 2_000), article("newer", timeUpdated = 10_000)))

        dao.addLocalArticleRows("a", listOf(image("a")), listOf(author("a")), now = 9_000)
        dao.addLocalArticleRows("newer", listOf(image("newer")), emptyList(), now = 9_000)

        assertEquals(listOf(image("a")), dao.getImagesForArticles(listOf("a")))
        assertEquals(listOf(author("a")), dao.getAuthorsForArticles(listOf("a")))
        assertEquals(9_000L, dao.getArticleById("a")!!.timeUpdated)
        // timeUpdated is never lowered.
        assertEquals(10_000L, dao.getArticleById("newer")!!.timeUpdated)
        val pushed = dao.getArticlesModifiedSinceKeyset(5_000, Long.MAX_VALUE, 5_000, "", 50).map { it.itemId }
        assertTrue("a" in pushed)
    }

    @Test
    fun insertArticleRows_leavesTheArticleUntouched() = runTest {
        dao.upsertArticles(listOf(article("a", timeUpdated = 2_000)))

        dao.insertArticleRows(listOf(image("a")), listOf(author("a")))

        assertEquals(2_000L, dao.getArticleById("a")!!.timeUpdated)
        assertTrue(dao.getArticlesModifiedSinceKeyset(5_000, Long.MAX_VALUE, 5_000, "", 50).isEmpty())
    }
}
