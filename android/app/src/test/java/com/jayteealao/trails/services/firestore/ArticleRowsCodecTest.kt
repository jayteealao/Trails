package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLDecoder

/**
 * The image and author row codec: what the backup writes reads back as the same row,
 * Firestore's number and missing-field shapes are handled, and row ids make valid,
 * reversible doc ids.
 */
class ArticleRowsCodecTest {

    private val image = ArticleImages(
        imageId = "1",
        itemId = "a1",
        src = "https://example.com/lead.jpg",
        width = 640,
        height = 480,
        credit = "Photo: someone",
        caption = "A caption",
    )

    private val author = ArticleAuthors(
        authorId = "7",
        itemId = "a1",
        name = "Ada Writer",
        url = "https://example.com/ada",
        domain = "example.com",
        image = null,
        bio = "Writes things",
        twitter = null,
    )

    @Test
    fun image_roundTripsThroughTheFieldMap() {
        val fields = image.toFirestoreFields()

        assertEquals(image, imageFromFirestore(rowDocId(image.imageId), fields, "a1"))
    }

    @Test
    fun author_roundTripsThroughTheFieldMap() {
        val fields = author.toFirestoreFields()

        assertEquals(author, authorFromFirestore(rowDocId(author.authorId), fields, "a1"))
    }

    @Test
    fun image_firestoreLongNumbersBecomeInts() {
        // Firestore hands integers back as Long.
        val stored = image.toFirestoreFields() + mapOf("width" to 640L, "height" to 480L)

        val read = imageFromFirestore("1", stored, "a1")!!

        assertEquals(640, read.width)
        assertEquals(480, read.height)
    }

    @Test
    fun image_missingOrBlankSrc_isSkipped() {
        assertNull(imageFromFirestore("1", image.toFirestoreFields() - "src", "a1"))
        assertNull(imageFromFirestore("1", image.toFirestoreFields() + ("src" to " "), "a1"))
    }

    @Test
    fun author_missingOrBlankName_isSkipped() {
        assertNull(authorFromFirestore("7", author.toFirestoreFields() - "name", "a1"))
        assertNull(authorFromFirestore("7", author.toFirestoreFields() + ("name" to ""), "a1"))
    }

    @Test
    fun missingOptionalFields_takeDefaults() {
        val readImage = imageFromFirestore("1", mapOf("src" to "https://x/y.png"), "a1")!!
        assertEquals(0, readImage.width)
        assertEquals(0, readImage.height)
        assertEquals("", readImage.credit)
        assertEquals("", readImage.caption)

        val readAuthor = authorFromFirestore("7", mapOf("name" to "N"), "a1")!!
        assertEquals("", readAuthor.url)
        assertNull(readAuthor.domain)
        assertNull(readAuthor.image)
        assertNull(readAuthor.bio)
        assertNull(readAuthor.twitter)
    }

    @Test
    fun missingIdField_fallsBackToTheDecodedDocId() {
        val docId = rowDocId("a/b c")

        val readImage = imageFromFirestore(docId, image.toFirestoreFields() - "imageId", "a1")!!
        val readAuthor = authorFromFirestore(docId, author.toFirestoreFields() - "authorId", "a1")!!

        assertEquals("a/b c", readImage.imageId)
        assertEquals("a/b c", readAuthor.authorId)
    }

    @Test
    fun parentItemId_winsOverAStoredOne() {
        val stored = image.toFirestoreFields() + ("itemId" to "other")
        val storedAuthor = author.toFirestoreFields() + ("itemId" to "other")

        assertEquals("a1", imageFromFirestore("1", stored, "a1")!!.itemId)
        assertEquals("a1", authorFromFirestore("7", storedAuthor, "a1")!!.itemId)
    }

    @Test
    fun rowDocId_keepsOrdinaryIds_andMakesEveryIdAValidReversibleDocId() {
        assertEquals("1", rowDocId("1"))
        for (id in listOf("a/b", ".", "..", "__a__", "x y", "a%2Fb", "a1:byline")) {
            val docId = rowDocId(id)
            assertFalse("$id -> $docId has a slash", docId.contains('/'))
            assertFalse("$id -> $docId is a reserved id", docId == "." || docId == "..")
            assertFalse(
                "$id -> $docId is a reserved __...__ id",
                docId.startsWith("__") && docId.endsWith("__")
            )
            assertEquals(id, URLDecoder.decode(docId, "UTF-8"))
        }
    }

    @Test
    fun groupRows_keysByItemId_andLeavesArticlesWithoutRowsOut() {
        val imageB = image.copy(imageId = "2", itemId = "b1")
        val authorC = author.copy(authorId = "9", itemId = "c1")

        val grouped = groupRows(listOf(image, imageB), listOf(author, authorC))

        assertEquals(setOf("a1", "b1", "c1"), grouped.keys)
        assertEquals(ArticleRows(listOf(image), listOf(author)), grouped["a1"])
        assertEquals(ArticleRows(listOf(imageB), emptyList()), grouped["b1"])
        assertEquals(ArticleRows(emptyList(), listOf(authorC)), grouped["c1"])
        assertTrue(groupRows(emptyList(), emptyList()).isEmpty())
    }

    @Test
    fun articleRows_countsOneWritePerRow() {
        assertTrue(ArticleRows().isEmpty())
        assertEquals(0, ArticleRows().writeCount)
        assertEquals(3, ArticleRows(listOf(image, image.copy(imageId = "2")), listOf(author)).writeCount)
    }

    @Test
    fun tag_readsTheFieldsTheBackupWrites_andSkipsADocWithoutATag() {
        // The backup writes ArticleTags through the object mapper: one field per property.
        val stored = mapOf<String, Any?>("itemId" to "other", "tag" to "garden", "sortId" to 2L, "type" to "user")

        assertEquals(ArticleTags("a1", "garden", 2, "user"), tagFromFirestore(stored, "a1"))
        assertEquals(ArticleTags("a1", "garden", null, null), tagFromFirestore(mapOf("tag" to "garden"), "a1"))
        assertNull(tagFromFirestore(mapOf("tag" to " "), "a1"))
        assertNull(tagFromFirestore(emptyMap(), "a1"))
    }

    @Test
    fun video_roundTripsThroughTheStoredFields() {
        val video = ArticleVideos("v/1", "a1", "https://example.com/clip.mp4", 640, 360, "mp4", "clip", 42, null)

        assertEquals(video, videoFromFirestore(rowDocId(video.videoId), video.toFirestoreFields(), "a1"))
        assertNull(videoFromFirestore("x", mapOf("src" to ""), "a1"))
    }
}
