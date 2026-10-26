package com.jayteealao.trails.data.local.database

import android.app.Application
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
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
 * Runs the search, tag-list and articles-by-id queries against a real in-memory database
 * on the bundled SQLite engine, seeded with live and deleted articles, and asserts the
 * result sets: a deleted article never comes back, and a tag that only deleted (or
 * missing) articles carry never appears in the tag list.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class DeletedFiltersQueryTest {

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

    private fun article(
        itemId: String,
        title: String,
        text: String? = null,
        deletedAt: Long? = null,
        resolvedId: String? = null,
    ) = Article(
        itemId = itemId,
        resolvedId = resolvedId,
        title = title,
        url = "https://example.com/$itemId",
        text = text,
        timeAdded = 1_600_000_000_000,
        timeUpdated = 1_600_000_000_000,
        deletedAt = deletedAt,
    )

    private fun tag(itemId: String, tag: String) = ArticleTags(itemId = itemId, tag = tag, sortId = null, type = null)

    private suspend fun seedRiverArticles() {
        dao.upsertArticles(
            listOf(
                article("live-1", "River walks", text = "A walk along the river bank."),
                article("del-1", "River crossings", text = "Crossing the river by ferry.", deletedAt = DELETED_AT),
            )
        )
    }

    @Test
    fun search_excludesDeletedArticle() = runTest {
        seedRiverArticles()

        // The exact pattern DefaultArticleRepository builds for the query "river".
        val hits = dao.searchArticlesRanked(RIVER_PATTERN, 100)

        assertEquals(setOf("live-1"), hits.map { it.itemId }.toSet())
    }

    @Test
    fun search_returnsLiveArticle() = runTest {
        seedRiverArticles()

        val hits = dao.searchArticlesRanked(RIVER_PATTERN, 100)

        assertTrue(hits.any { it.itemId == "live-1" })
    }

    @Test
    fun allTags_excludesTagOnlyOnDeletedArticle() = runTest {
        seedRiverArticles()
        dao.insertArticleTags(listOf(tag("del-1", "gone"), tag("live-1", "kept")))

        assertEquals(listOf("kept"), dao.getAllTags().first())
    }

    @Test
    fun allTags_keepsTagSharedByLiveAndDeletedArticle() = runTest {
        seedRiverArticles()
        dao.insertArticleTags(listOf(tag("live-1", "both"), tag("del-1", "both")))

        assertEquals(listOf("both"), dao.getAllTags().first())
    }

    @Test
    fun allTags_excludesOrphanTag() = runTest {
        seedRiverArticles()
        dao.insertArticleTags(listOf(tag("live-1", "kept"), tag("no-such-article", "orphan")))

        assertEquals(listOf("kept"), dao.getAllTags().first())
    }

    @Test
    fun allTags_keepsTagMatchedThroughResolvedId() = runTest {
        dao.upsertArticles(listOf(article("live-2", "Mountain huts", resolvedId = "pocket-9")))
        dao.insertArticleTags(listOf(tag("pocket-9", "huts")))

        assertEquals(listOf("huts"), dao.getAllTags().first())
    }

    @Test
    fun allTags_ordersCaseInsensitively() = runTest {
        dao.upsertArticles(listOf(article("live-4", "Ferns"), article("live-5", "Mosses")))
        dao.insertArticleTags(listOf(tag("live-4", "beta"), tag("live-5", "Alpha")))

        assertEquals(listOf("Alpha", "beta"), dao.getAllTags().first())
    }

    @Test
    fun allTags_dropsTagWhenItsArticleIsDeleted() = runTest {
        dao.upsertArticles(listOf(article("live-3", "Solo hikes")))
        dao.insertArticleTags(listOf(tag("live-3", "solo")))

        // Real dispatcher and real-time timeout: Room delivers invalidations on its own threads.
        withContext(Dispatchers.Default) {
            val emissions = Channel<List<String>>(Channel.UNLIMITED)
            // Subscribed before the delete, so a later emission can only come from invalidation.
            val collector = launch { dao.getAllTags().collect { emissions.send(it) } }
            try {
                withTimeout(5_000) {
                    assertEquals(listOf("solo"), emissions.receive())
                    dao.updateDeleted("live-3", DELETED_AT)
                    while ("solo" in emissions.receive()) Unit
                }
            } finally {
                collector.cancel()
            }
        }
    }

    @Test
    fun articlesByIds_excludesDeletedArticle() = runTest {
        seedRiverArticles()

        val found = dao.getArticlesByIds(listOf("live-1", "del-1"))

        assertEquals(listOf("live-1"), found.map { it.itemId })
    }

    private companion object {
        const val RIVER_PATTERN = "\"river\""
        const val DELETED_AT = 1_700_000_000_000
    }
}
