package com.jayteealao.trails.services.firestore

import androidx.room3.ColumnInfo
import com.google.firebase.firestore.util.CustomClassMapper
import com.jayteealao.trails.services.firestore.UserArticleWireWriteTest.Companion.GOLDEN_FULL
import com.jayteealao.trails.services.firestore.UserArticleWireWriteTest.Companion.assertSameWire
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A rename in the local database must not rename a stored field. [RenamedArticle] is the
 * article entity with two properties renamed (`title` → `headline`, `normalizedUrl` →
 * `canonicalUrl`, with its column); its mapping to the wire type differs from the real one
 * only on the right-hand side of those two lines, which is all a real rename would change.
 */
class UserArticleWireRenameTest {

    @Test
    fun `a renamed entity writes the same field names and values`() {
        val written = renamedFullArticle().toUserArticleWire().toFirestore()

        assertSameWire(GOLDEN_FULL, written)
    }

    @Test
    fun `the object mapper would have written the renamed names`() {
        // Negative control: serialising the entity itself, as the backup once did, follows the rename.
        val mapped = CustomClassMapper.convertToPlainJavaTypes(renamedFullArticle()) as Map<*, *>

        assertTrue(mapped.containsKey("headline"))
        assertFalse(mapped.containsKey("title"))
        assertTrue(mapped.containsKey("canonicalUrl"))
        assertFalse(mapped.containsKey("normalizedUrl"))
    }

    private fun renamedFullArticle(): RenamedArticle {
        val a = UserArticleWireWriteTest.fullArticle()
        return RenamedArticle(
            itemId = a.itemId,
            resolvedId = a.resolvedId,
            headline = a.title,
            givenTitle = a.givenTitle,
            url = a.url,
            givenUrl = a.givenUrl,
            canonicalUrl = a.normalizedUrl,
            excerpt = a.excerpt,
            wordCount = a.wordCount,
            favorite = a.favorite,
            status = a.status,
            wordCountMessage = a.wordCountMessage,
            image = a.image,
            hasImage = a.hasImage,
            hasVideo = a.hasVideo,
            hasAudio = a.hasAudio,
            sortId = a.sortId,
            timeAdded = a.timeAdded,
            timeUpdated = a.timeUpdated,
            timeRead = a.timeRead,
            timeFavorited = a.timeFavorited,
            timeToRead = a.timeToRead,
            listenDurationEstimate = a.listenDurationEstimate,
            text = a.text,
            articleId = a.articleId,
            resolved = a.resolved,
            deletedAt = a.deletedAt,
            archivedAt = a.archivedAt,
            textSource = a.textSource,
        )
    }
}

/** The article entity with `title` and `normalizedUrl` renamed; test-only. */
data class RenamedArticle(
    val itemId: String = "",
    val resolvedId: String? = null,
    val headline: String = "",
    val givenTitle: String = "",
    val url: String? = null,
    val givenUrl: String? = null,
    @ColumnInfo(name = "canonical_url") val canonicalUrl: String? = null,
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
)

/** The real mapping with only the two renamed right-hand sides changed. */
private fun RenamedArticle.toUserArticleWire() = UserArticleWire(
    itemId = itemId,
    resolvedId = resolvedId,
    title = headline,
    givenTitle = givenTitle,
    url = url,
    givenUrl = givenUrl,
    normalizedUrl = canonicalUrl,
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
    backedUpAt = timeUpdated,
)
