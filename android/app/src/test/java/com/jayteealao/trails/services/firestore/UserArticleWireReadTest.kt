package com.jayteealao.trails.services.firestore

import com.google.firebase.Timestamp
import com.google.firebase.firestore.util.CustomClassMapper
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.services.firestore.UserArticleWireWriteTest.Companion.GOLDEN_FULL
import com.jayteealao.trails.services.firestore.UserArticleWireWriteTest.Companion.fullArticle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.lang.reflect.Modifier

/**
 * Stored user-article documents, as app versions in users' hands and the server wrote
 * them, read by the reader those app versions run: Firestore's object mapper on the
 * article shape they ship. Each fixture pins the article that reader yields, or that it
 * throws. Integers are `Long`, as `DocumentSnapshot.getData()` hands them out.
 */
class UserArticleWireReadTest {

    @Test
    fun `F1 a doc as the backup writes it, with server fields, reads to the full article`() {
        assertEquals(fullArticle(), deployedRead(F1))
        assertEquals(fullArticle(), dtoRead(F1))
    }

    @Test
    fun `F2 a doc an older build wrote with the object mapper reads its fields`() {
        assertEquals(F2_ARTICLE, deployedRead(F2))
        assertEquals(F2_ARTICLE, dtoRead(F2))
    }

    @Test
    fun `F3 a sparse doc reads the defaults for every missing field`() {
        assertEquals(F3_ARTICLE, deployedRead(F3))
        assertEquals(F3_ARTICLE, dtoRead(F3))
    }

    @Test
    fun `F4 explicit nulls read as null, an absent field as its default`() {
        assertEquals(F4_ARTICLE, deployedRead(F4))
        assertEquals(0, deployedRead(F3).timeToRead)
        assertEquals(F4_ARTICLE, dtoRead(F4))
        assertEquals(0, dtoRead(F3).timeToRead)
    }

    @Test
    fun `F5 a double in an int and a long field is truncated`() {
        assertEquals(F5_ARTICLE, deployedRead(F5))
        assertEquals(F5_ARTICLE, dtoRead(F5))
    }

    @Test
    fun `F6 a dashboard-queued doc with a timestamp timeAdded reads it as epoch milliseconds`() {
        // App versions in users' hands throw on it; this reader restores the article.
        assertThrows(RuntimeException::class.java) { deployedRead(F6) }
        assertEquals(F6_ARTICLE, dtoRead(F6))
    }

    @Test
    fun `F7 a number in title throws`() {
        assertThrows(RuntimeException::class.java) { deployedRead(F7) }
        assertThrows(IllegalArgumentException::class.java) { dtoRead(F7) }
    }

    @Test
    fun `F8 a long out of int range in wordCount throws`() {
        assertThrows(RuntimeException::class.java) { deployedRead(F8) }
        assertThrows(IllegalArgumentException::class.java) { dtoRead(F8) }
    }

    @Test
    fun `F10 a null in a non-null boolean throws`() {
        assertThrows(RuntimeException::class.java) { deployedRead(F10) }
        assertThrows(IllegalArgumentException::class.java) { dtoRead(F10) }
    }

    @Test
    fun `F9 a null title reads as a null title`() {
        // Observed: the object mapper stores null in the non-null property.
        val title: String? = deployedBean(F9).title
        assertNull(title)
        // The wire type reads the field's default instead: Kotlin cannot hold that null.
        assertEquals("", dtoRead(F9).title)
    }

    @Test
    fun `the frozen deployed shape reads the names the wire type reads`() {
        // Against the wire names, not the entity, so it holds through a later entity rename.
        val wireNames = UserArticleWire::class.java.declaredFields
            .filter { Modifier.isStatic(it.modifiers) && it.type == String::class.java }
            .map { it.get(null) as String }
            .toSet() - UserArticleWire.BACKED_UP_AT
        assertEquals(wireNames, fieldShape(DeployedArticleBean::class.java).keys)
    }

    companion object {
        /** Firestore hands every stored integer out as a `Long`. */
        fun stored(fields: Map<String, Any?>): Map<String, Any?> =
            fields.mapValues { (_, value) -> if (value is Int) value.toLong() else value }

        fun deployedBean(map: Map<String, Any?>): DeployedArticleBean =
            CustomClassMapper.convertToCustomClass(map, DeployedArticleBean::class.java, null)

        fun deployedRead(map: Map<String, Any?>): Article = deployedBean(map).toArticle()

        fun dtoRead(map: Map<String, Any?>): Article = UserArticleWire.fromFirestore(map).toArticle()

        private fun fieldShape(cls: Class<*>): Map<String, Class<*>> = cls.declaredFields
            .filter { !Modifier.isStatic(it.modifiers) && !it.isSynthetic }
            .associate { it.name to it.type }

        val F1: Map<String, Any?> = stored(GOLDEN_FULL) + mapOf(
            "resolvedId" to "resolved-1",
            "canonicalId" to "canonical-1",
            "pocket" to mapOf("resolved_id" to "canonical-1", "time_added" to 1_700_000_000L),
            "archival_triggered" to true,
        )

        /** What an older build wrote: the whole object mapped, no `backedUpAt`, legacy `deleted_at`. */
        val F2: Map<String, Any?> = mapOf(
            "itemId" to "item-2",
            "resolvedId" to "resolved-2",
            "title" to "Old title",
            "givenTitle" to "Old given",
            "url" to "https://example.com/old",
            "givenUrl" to "https://example.com/old-given",
            "normalizedUrl" to "https://example.com/old",
            "excerpt" to null,
            "wordCount" to 300L,
            "favorite" to "0",
            "status" to "0",
            "wordCountMessage" to null,
            "image" to null,
            "hasImage" to false,
            "hasVideo" to false,
            "hasAudio" to true,
            "sortId" to 3L,
            "timeAdded" to 1_600_000_000_000L,
            "timeUpdated" to 1_600_000_000_500L,
            "timeRead" to null,
            "timeFavorited" to 0L,
            "timeToRead" to 2L,
            "listenDurationEstimate" to 90L,
            "text" to "Old body",
            "articleId" to "77",
            "resolved" to 1L,
            "deletedAt" to null,
            "deleted_at" to 1_600_000_000_900L,
            "archivedAt" to null,
            "textSource" to "",
        )
        val F2_ARTICLE = Article(
            itemId = "item-2",
            resolvedId = "resolved-2",
            title = "Old title",
            givenTitle = "Old given",
            url = "https://example.com/old",
            givenUrl = "https://example.com/old-given",
            normalizedUrl = "https://example.com/old",
            wordCount = 300,
            favorite = "0",
            status = "0",
            hasAudio = true,
            sortId = 3,
            timeAdded = 1_600_000_000_000L,
            timeUpdated = 1_600_000_000_500L,
            timeToRead = 2,
            listenDurationEstimate = 90,
            text = "Old body",
            articleId = "77",
            resolved = 1,
        )

        val F3: Map<String, Any?> = mapOf(
            "itemId" to "item-3",
            "url" to "https://example.com/sparse",
            "timeAdded" to 1_650_000_000_000L,
        )
        val F3_ARTICLE = Article(
            itemId = "item-3",
            url = "https://example.com/sparse",
            timeAdded = 1_650_000_000_000L,
        )

        val F4: Map<String, Any?> = mapOf(
            "itemId" to "item-4",
            "url" to null,
            "excerpt" to null,
            "timeRead" to null,
            "timeToRead" to null,
            "text" to null,
            "deletedAt" to null,
            "archivedAt" to null,
        )
        val F4_ARTICLE = Article(itemId = "item-4", timeToRead = null)

        val F5: Map<String, Any?> = mapOf(
            "itemId" to "item-5",
            "wordCount" to 12.7,
            "timeAdded" to 1_650_000_000_000.9,
        )
        val F5_ARTICLE = Article(itemId = "item-5", wordCount = 12, timeAdded = 1_650_000_000_000L)

        /** As the dashboard queue writes a user article. */
        val F6: Map<String, Any?> = mapOf(
            "itemId" to "item-6",
            "url" to "https://example.com/queued",
            "timeAdded" to Timestamp(1_700_000_000L, 0),
            "queued_at" to Timestamp(1_700_000_000L, 0),
            "queued_by" to "dashboard",
        )
        val F6_ARTICLE = Article(
            itemId = "item-6",
            url = "https://example.com/queued",
            timeAdded = 1_700_000_000_000L,
        )

        val F7: Map<String, Any?> = mapOf("itemId" to "item-7", "title" to 42L)

        val F8: Map<String, Any?> = mapOf("itemId" to "item-8", "wordCount" to 3_000_000_000L)

        val F9: Map<String, Any?> = mapOf("itemId" to "item-9", "title" to null)

        val F10: Map<String, Any?> = mapOf("itemId" to "item-10", "hasImage" to null)
    }
}

/**
 * The article shape that app versions in users' hands read user-article documents into:
 * the property names, types and defaults of the article entity when this test was written,
 * frozen. It does not follow a later rename of the entity.
 */
data class DeployedArticleBean(
    val itemId: String = "",
    val resolvedId: String? = null,
    val title: String = "",
    val givenTitle: String = "",
    val url: String? = null,
    val givenUrl: String? = null,
    val normalizedUrl: String? = null,
    val excerpt: String? = null,
    val wordCount: Int = 0,
    val favorite: String? = null,
    val status: String = "",
    val wordCountMessage: String? = null,
    val image: String? = null,
    val hasImage: Boolean = false,
    val hasVideo: Boolean = false,
    val hasAudio: Boolean = false,
    val sortId: Int = 0,
    val timeAdded: Long = 0,
    val timeUpdated: Long = 0,
    val timeRead: Long? = null,
    val timeFavorited: Long = 0,
    val timeToRead: Int? = 0,
    val listenDurationEstimate: Int = 0,
    var text: String? = null,
    val articleId: String = "0",
    val resolved: Int = 0,
    val deletedAt: Long? = null,
    val archivedAt: Long? = null,
    val textSource: String = "",
) {
    fun toArticle() = Article(
        itemId = itemId,
        resolvedId = resolvedId,
        title = title,
        givenTitle = givenTitle,
        url = url,
        givenUrl = givenUrl,
        normalizedUrl = normalizedUrl,
        excerpt = excerpt,
        wordCount = wordCount,
        favorite = favorite,
        status = status,
        wordCountMessage = wordCountMessage,
        image = image,
        hasImage = hasImage,
        hasVideo = hasVideo,
        hasAudio = hasAudio,
        sortId = sortId,
        timeAdded = timeAdded,
        timeUpdated = timeUpdated,
        timeRead = timeRead,
        timeFavorited = timeFavorited,
        timeToRead = timeToRead,
        listenDurationEstimate = listenDurationEstimate,
        text = text,
        articleId = articleId,
        resolved = resolved,
        deletedAt = deletedAt,
        archivedAt = archivedAt,
        textSource = textSource,
    )
}
