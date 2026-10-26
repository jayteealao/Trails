package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.testing.MapBackedFirestore
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The backup service writes each article's image and author rows as docs in the
 * article's batch, writes nothing for an article without rows, keeps an article and
 * its rows in one batch under the write threshold, and reads rows back through the
 * row codec (never the object mapper).
 */
class FirestoreBackupServiceRowsTest {

    private lateinit var fake: MapBackedFirestore
    private lateinit var service: FirestoreBackupService

    private val articles = "users/u1/articles"

    @Before
    fun setUp() {
        fake = MapBackedFirestore()
        service = FirestoreBackupService(fake.firestore, fake.auth)
    }

    private fun article(id: String) = Article(
        itemId = id,
        title = "Title $id",
        url = "https://example.com/$id",
        text = "body",
    )

    private fun image(itemId: String, imageId: String) = ArticleImages(
        imageId = imageId,
        itemId = itemId,
        src = "https://example.com/$itemId/$imageId.jpg",
        width = 10,
        height = 20,
        credit = "c",
        caption = "cap",
    )

    private fun author(itemId: String, authorId: String) = ArticleAuthors(
        authorId = authorId,
        itemId = itemId,
        name = "Name $authorId",
        url = "https://example.com/$authorId",
        domain = null,
        image = null,
        bio = null,
        twitter = null,
    )

    @Test
    fun articleWithoutRows_writesNoImageOrAuthorEntry() = runTest {
        val tag = ArticleTags(itemId = "a1", tag = "t", sortId = null, type = null)

        val result = service.backupArticlesPaginated(listOf(article("a1")), mapOf("a1" to listOf(tag)))

        assertEquals(Result.success(1), result)
        val articleDoc = fake.document("$articles/a1")
        verify(exactly = 0) { articleDoc.collection("images") }
        verify(exactly = 0) { articleDoc.collection("authors") }
        assertEquals(listOf(listOf("$articles/a1", "$articles/a1/tags/a1_t")), fake.commits)
    }

    @Test
    fun rowsAreWrittenInTheArticlesBatchWithTheCodecMap() = runTest {
        val rows = ArticleRows(
            images = listOf(image("a1", "1"), image("a1", "2")),
            authors = listOf(author("a1", "7")),
        )

        val result = service.backupArticlesPaginated(listOf(article("a1")), rowsByArticleId = mapOf("a1" to rows))

        assertEquals(Result.success(1), result)
        assertEquals(1, fake.commits.size)
        assertEquals(
            listOf("$articles/a1", "$articles/a1/images/1", "$articles/a1/images/2", "$articles/a1/authors/7"),
            fake.commits.single(),
        )
        assertEquals(image("a1", "1").toFirestoreFields(), fake.docs["$articles/a1/images/1"])
        assertEquals(image("a1", "2").toFirestoreFields(), fake.docs["$articles/a1/images/2"])
        assertEquals(author("a1", "7").toFirestoreFields(), fake.docs["$articles/a1/authors/7"])
    }

    @Test
    fun rowsCountTowardTheWriteThreshold_andNoArticleIsSplit() = runTest {
        val ids = (1..20).map { "a$it" }
        // 1 article doc + 30 rows = 31 writes per article: 16 articles fit under 500.
        val rowsById = ids.associateWith { id ->
            ArticleRows(images = (1..20).map { image(id, "$it") }, authors = (1..10).map { author(id, "$id-$it") })
        }

        val result = service.backupArticlesPaginated(ids.map { article(it) }, rowsByArticleId = rowsById)

        assertEquals(Result.success(20), result)
        assertTrue("expected more than one batch", fake.commits.size > 1)
        val seenArticles = mutableListOf<String>()
        fake.commits.forEach { paths ->
            assertTrue("batch of ${paths.size} writes", paths.size <= 500)
            val batchArticles = paths.map { it.removePrefix("$articles/").substringBefore('/') }.toSet()
            batchArticles.forEach { id ->
                // Every write of an article sits in the one batch that holds its doc.
                assertEquals(31, paths.count { it.removePrefix("$articles/").substringBefore('/') == id })
            }
            seenArticles += batchArticles
        }
        assertEquals(ids.toSet(), seenArticles.toSet())
        assertEquals(ids.size, seenArticles.size)
    }

    @Test
    fun backupArticle_writesRowsThroughTheSameCodec() = runTest {
        val result = service.backupArticle(
            article = article("a1"),
            images = listOf(image("a1", "1")),
            authors = listOf(author("a1", "7")),
        )

        assertTrue(result.isSuccess)
        assertEquals(image("a1", "1").toFirestoreFields(), fake.docs["$articles/a1/images/1"])
        assertEquals(author("a1", "7").toFirestoreFields(), fake.docs["$articles/a1/authors/7"])
    }

    @Test
    fun restoreReaders_parseStoredMaps_andSkipUnusableDocs() = runTest {
        fake.docs["$articles/a1/images/1"] = image("a1", "1").toFirestoreFields() + mapOf("width" to 10L, "height" to 20L)
        fake.docs["$articles/a1/images/2"] = image("a1", "2").toFirestoreFields()
        fake.docs["$articles/a1/images/3"] = image("a1", "3").toFirestoreFields() - "src"
        fake.docs["$articles/a1/authors/7"] = author("a1", "7").toFirestoreFields()
        fake.docs["$articles/a1/authors/8"] = author("a1", "8").toFirestoreFields() + ("name" to "")

        val images = service.restoreArticleImages("a1").getOrThrow()
        val authors = service.restoreArticleAuthors("a1").getOrThrow()

        assertEquals(setOf(image("a1", "1"), image("a1", "2")), images.toSet())
        assertEquals(2, images.size)
        assertEquals(listOf(author("a1", "7")), authors)
    }

    @Test
    fun batchRestoreArticleRows_leavesOutAnArticleWhoseReadFailed() = runTest {
        fake.docs["$articles/a/images/1"] = image("a", "1").toFirestoreFields()
        fake.docs["$articles/b/images/1"] = image("b", "1").toFirestoreFields()
        fake.failingReads += "$articles/b/images"

        val rows = service.batchRestoreArticleRows(listOf("a", "b", "c"))

        assertEquals(setOf("a", "c"), rows.keys)
        assertEquals(ArticleRows(images = listOf(image("a", "1"))), rows["a"])
        assertEquals(ArticleRows(), rows["c"])
    }
}
