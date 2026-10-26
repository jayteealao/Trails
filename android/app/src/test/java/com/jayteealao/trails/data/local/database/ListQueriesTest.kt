package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.paging.PagingSource
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Pins what the library, favourite, archive and tag lists return (ids in order and each
 * row's tags) on a real in-memory database, so a rewrite of their SQL keeps the results.
 *
 * Seed: a1…a8 with timeAdded 100…800; a2 archived; a3 deleted; a4 and a5 favourite
 * (a4 favourited later, so it sorts first although it was added earlier); a6 carries
 * resolvedId r6. Tags: x on a1, a2, a3 and on r6 (keyed by the resolved id); y on a1 and a4.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ListQueriesTest {

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

    private fun article(n: Int, block: (Article) -> Article = { it }) = block(
        Article(
            itemId = "a$n",
            title = "Article $n",
            url = "https://example.com/a$n",
            timeAdded = n * 100L,
            timeUpdated = n * 100L,
        )
    )

    private fun tag(itemId: String, tag: String) = ArticleTags(itemId = itemId, tag = tag, sortId = null, type = null)

    private suspend fun seed() {
        dao.upsertArticles(
            listOf(
                article(1),
                article(2) { it.copy(archivedAt = 2_000L) },
                article(3) { it.copy(deletedAt = 3_000L) },
                article(4) { it.copy(favorite = "1", timeFavorited = 2_000L) },
                article(5) { it.copy(favorite = "1", timeFavorited = 1_000L) },
                article(6) { it.copy(resolvedId = "r6") },
                article(7),
                article(8),
            )
        )
        dao.insertArticleTags(
            listOf(
                tag("a1", "x"), tag("a2", "x"), tag("a3", "x"), tag("r6", "x"),
                tag("a1", "y"), tag("a4", "y"),
            )
        )
    }

    private suspend fun PagingSource<Int, ArticleItem>.firstPage(): List<ArticleItem> {
        val result = load(PagingSource.LoadParams.Refresh(key = null, loadSize = 50, placeholdersEnabled = false))
        return (result as PagingSource.LoadResult.Page).data
    }

    /** Ids in list order, each with its tags as a set (GROUP_CONCAT order is not defined). */
    private fun List<ArticleItem>.idsAndTags(): List<Pair<String, Set<String>>> =
        map { item -> item.itemId to item.tagsString.orEmpty().split(',').filter { it.isNotEmpty() }.toSet() }

    @Test
    fun mainList_liveUnarchivedNewestFirst() = runTest {
        seed()

        assertEquals(
            listOf(
                "a8" to emptySet(),
                "a7" to emptySet(),
                "a6" to emptySet(),
                "a5" to emptySet(),
                "a4" to setOf("y"),
                "a1" to setOf("x", "y"),
            ),
            dao.getArticlesWithTags().firstPage().idsAndTags(),
        )
    }

    @Test
    fun favorites_latestFavouriteFirst() = runTest {
        seed()

        assertEquals(
            listOf("a4" to setOf("y"), "a5" to emptySet()),
            dao.getFavoriteArticlesWithTags().firstPage().idsAndTags(),
        )
    }

    @Test
    fun archive_archivedLiveOnly() = runTest {
        seed()

        assertEquals(
            listOf("a2" to setOf("x")),
            dao.getArchivedArticlesWithTags().firstPage().idsAndTags(),
        )
    }

    @Test
    fun tagView_matchesItemIdAndResolvedId_excludesDeleted() = runTest {
        seed()

        assertEquals(
            listOf("a6" to setOf("x"), "a2" to setOf("x"), "a1" to setOf("x", "y")),
            dao.getArticlesWithTag("x").firstPage().idsAndTags(),
        )
    }

    @Test
    fun tagView_secondTag() = runTest {
        seed()

        assertEquals(
            listOf("a4" to setOf("y"), "a1" to setOf("x", "y")),
            dao.getArticlesWithTag("y").firstPage().idsAndTags(),
        )
    }

    @Test
    fun listItems_carryFavouriteFlag() = runTest {
        seed()

        val favourites = dao.getArticlesWithTags().firstPage().filter { it.favorite }.map { it.itemId }
        assertEquals(listOf("a5", "a4"), favourites)
    }
}
