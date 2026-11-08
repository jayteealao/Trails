package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.data.local.database.Article
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pins the field map the backup writes on `users/{uid}/articles/{id}`. The golden maps
 * below are the exact output of the backup's article map before the user article got its
 * own wire type: every key, in order, every value and every value's class. App versions
 * in users' hands and the server read these names, so a change here is a wire change.
 */
class UserArticleWireWriteTest {

    @Test
    fun `backup fields of a full article equal the golden map`() {
        assertSameWire(GOLDEN_FULL, fullArticle().toBackupFields())
    }

    @Test
    fun `backup fields of an article with every nullable property null equal the golden map`() {
        assertSameWire(GOLDEN_NULLS, nullsArticle().toBackupFields())
    }

    @Test
    fun `the wire type writes the golden map of a full article`() {
        assertSameWire(GOLDEN_FULL, fullArticle().toUserArticleWire().toFirestore())
    }

    @Test
    fun `the wire type writes the golden map of an article with every nullable property null`() {
        assertSameWire(GOLDEN_NULLS, nullsArticle().toUserArticleWire().toFirestore())
    }

    companion object {
        /** An article with every one of its properties set to a distinct, non-default value. */
        fun fullArticle() = Article(
            itemId = "item-1",
            resolvedId = "resolved-1",
            title = "Title one",
            givenTitle = "Given title",
            url = "https://example.com/a",
            givenUrl = "https://example.com/given",
            normalizedUrl = "https://example.com/normalized",
            excerpt = "An excerpt",
            wordCount = 1234,
            favorite = "1",
            status = "2",
            wordCountMessage = "5 min read",
            image = "https://example.com/a.png",
            hasImage = true,
            hasVideo = true,
            hasAudio = true,
            sortId = 7,
            timeAdded = 1_700_000_000_001L,
            timeUpdated = 1_700_000_000_002L,
            timeRead = 1_700_000_000_003L,
            timeFavorited = 1_700_000_000_004L,
            timeToRead = 11,
            listenDurationEstimate = 12,
            text = "Body text",
            articleId = "article-9",
            resolved = 10,
            deletedAt = 1_700_000_000_005L,
            archivedAt = 1_700_000_000_006L,
            textSource = "readability",
        )

        /** An article with every nullable property null and the others at their defaults. */
        fun nullsArticle() = Article(itemId = "item-2", timeToRead = null)

        val GOLDEN_FULL: Map<String, Any?> = linkedMapOf(
            "itemId" to "item-1",
            "title" to "Title one",
            "givenTitle" to "Given title",
            "url" to "https://example.com/a",
            "givenUrl" to "https://example.com/given",
            "normalizedUrl" to "https://example.com/normalized",
            "excerpt" to "An excerpt",
            "wordCount" to 1234,
            "favorite" to "1",
            "status" to "2",
            "wordCountMessage" to "5 min read",
            "image" to "https://example.com/a.png",
            "hasImage" to true,
            "hasVideo" to true,
            "hasAudio" to true,
            "sortId" to 7,
            "timeAdded" to 1_700_000_000_001L,
            "timeUpdated" to 1_700_000_000_002L,
            "timeRead" to 1_700_000_000_003L,
            "timeFavorited" to 1_700_000_000_004L,
            "timeToRead" to 11,
            "listenDurationEstimate" to 12,
            "text" to "Body text",
            "articleId" to "article-9",
            "resolved" to 10,
            "deletedAt" to 1_700_000_000_005L,
            "archivedAt" to 1_700_000_000_006L,
            "textSource" to "readability",
            "backedUpAt" to 1_700_000_000_002L,
        )

        val GOLDEN_NULLS: Map<String, Any?> = linkedMapOf(
            "itemId" to "item-2",
            "title" to "",
            "givenTitle" to "",
            "url" to null,
            "givenUrl" to null,
            "normalizedUrl" to null,
            "excerpt" to null,
            "wordCount" to 0,
            "favorite" to null,
            "status" to "",
            "wordCountMessage" to null,
            "image" to null,
            "hasImage" to false,
            "hasVideo" to false,
            "hasAudio" to false,
            "sortId" to 0,
            "timeAdded" to 0L,
            "timeUpdated" to 0L,
            "timeRead" to null,
            "timeFavorited" to 0L,
            "timeToRead" to null,
            "listenDurationEstimate" to 0,
            "text" to null,
            "articleId" to "0",
            "resolved" to 0,
            "deletedAt" to null,
            "archivedAt" to null,
            "textSource" to "",
            "backedUpAt" to 0L,
        )

        /** Same keys in the same order, same values, and each value of the same class. */
        fun assertSameWire(expected: Map<String, Any?>, actual: Map<String, Any?>) {
            assertEquals(expected.keys.toList(), actual.keys.toList())
            expected.forEach { (key, value) ->
                assertEquals("value of $key", value, actual[key])
                assertEquals("class of $key", value?.javaClass, actual[key]?.javaClass)
            }
        }
    }
}
