package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.paging.PagingSource
import androidx.room3.useReaderConnection
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * Records how long the first page of each list takes on 5,000 articles, on the bundled
 * SQLite engine the app ships. The numbers are recorded, not gated: they are the list-query
 * figures that the search work compares against.
 *
 * For the library, favourite, archive and tag lists: the first page through the DAO's
 * PagingSource, and the raw first page as Room's paging wraps it. Then the seven indexes are
 * dropped and the version 8 library query (the GROUP BY form) is timed on the same rows as
 * the before figure. Written to `build/reports/benchmark/list-query.json`.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ListQueryBenchmarkTest {

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

    /** 5,000 articles: 10% archived, 5% deleted, 10% favourite, two tags each. */
    private suspend fun seed() {
        val articles = (1..ROWS).map { n ->
            Article(
                itemId = "a$n",
                resolvedId = "r$n",
                title = "Article $n",
                url = "https://example.com/a$n",
                normalizedUrl = "example.com/a$n",
                excerpt = "Excerpt of article $n",
                timeAdded = n * 10L,
                timeUpdated = n * 10L,
                favorite = if (n % 10 == 1) "1" else null,
                timeFavorited = if (n % 10 == 1) n * 10L else 0,
                archivedAt = if (n % 10 == 2) n * 10L else null,
                deletedAt = if (n % 20 == 3) n * 10L else null,
            )
        }
        val tags = (1..ROWS).flatMap { n ->
            listOf(
                ArticleTags(itemId = "a$n", tag = "topic${n % 50}", sortId = null, type = null),
                ArticleTags(itemId = "a$n", tag = "source${n % 7}", sortId = null, type = null),
            )
        }
        dao.upsertArticles(articles)
        dao.insertArticleTags(tags)
    }

    private suspend fun PagingSource<Int, ArticleItem>.firstPageSize(): Int {
        val result = load(PagingSource.LoadParams.Refresh(key = null, loadSize = PAGE, placeholdersEnabled = false))
        return (result as PagingSource.LoadResult.Page).data.size
    }

    private suspend fun rawFirstPage(sql: String): Int = db.useReaderConnection { connection ->
        connection.usePrepared("SELECT * FROM ($sql) LIMIT $PAGE OFFSET 0") { s ->
            if (sql.contains(":tag")) s.bindText(1, TAG)
            var rows = 0
            while (s.step()) rows++
            rows
        }
    }

    /** 3 warm-up and [TIMED] timed runs of [block], each of which must return a full page. */
    private suspend fun time(name: String, block: suspend () -> Int): JSONObject {
        repeat(3) { assertEquals(name, PAGE, block()) }
        val ms = (1..TIMED).map {
            val start = System.nanoTime()
            val rows = block()
            val elapsed = (System.nanoTime() - start) / 1_000_000.0
            assertEquals(name, PAGE, rows)
            elapsed
        }.sorted()
        return JSONObject()
            .put("query", name)
            .put("medianMs", (ms[TIMED / 2 - 1] + ms[TIMED / 2]) / 2)
            .put("p90Ms", ms[(TIMED * 9 + 9) / 10 - 1])
            .put("iterations", TIMED)
    }

    @Test
    fun firstPageOfEachList_onFiveThousandArticles_isRecorded() = runTest {
        seed()
        val sqliteVersion = db.useReaderConnection { c -> c.usePrepared("SELECT sqlite_version()") { it.step(); it.getText(0) } }

        val entries = mutableListOf<JSONObject>()
        entries += time("MAIN_LIST paging") { dao.getArticlesWithTags().firstPageSize() }
        entries += time("FAVORITE_LIST paging") { dao.getFavoriteArticlesWithTags().firstPageSize() }
        entries += time("ARCHIVE_LIST paging") { dao.getArchivedArticlesWithTags().firstPageSize() }
        entries += time("TAG_LIST_BY_TAG paging") { dao.getArticlesWithTag(TAG).firstPageSize() }
        entries += time("MAIN_LIST raw") { rawFirstPage(ArticleSql.MAIN_LIST) }
        entries += time("FAVORITE_LIST raw") { rawFirstPage(ArticleSql.FAVORITE_LIST) }
        entries += time("ARCHIVE_LIST raw") { rawFirstPage(ArticleSql.ARCHIVE_LIST) }
        entries += time("TAG_LIST_BY_TAG raw") { rawFirstPage(ArticleSql.TAG_LIST_BY_TAG) }

        // Before: the version 8 library query without the version 9 indexes, on the same rows.
        db.useWriterConnection { c -> NEW_INDEXES.forEach { c.executeSQL("DROP INDEX $it") } }
        entries += time("MAIN_LIST version 8 (GROUP BY, no indexes) raw") { rawFirstPage(VERSION_8_MAIN_LIST) }

        val report = JSONArray()
        entries.forEach {
            report.put(it.put("engine", "bundled SQLite (JVM)").put("sqliteVersion", sqliteVersion).put("rows", ROWS))
        }
        val text = report.toString(2)
        println(text)
        val file = File("build/reports/benchmark/list-query.json")
        file.parentFile?.mkdirs()
        file.writeText(text)
    }

    private companion object {
        const val ROWS = 5_000
        const val PAGE = 50
        const val TIMED = 10
        const val TAG = "topic7"

        val NEW_INDEXES = listOf(
            "index_article_deleted_at_archived_at_timeAdded",
            "index_article_deleted_at_archived_at_timeFavorited_timeAdded",
            "index_article_timeUpdated_itemId",
            "index_article_resolvedId",
            "index_article_normalized_url",
            "index_article_tags_tag",
        )

        /** The library query as version 8 shipped it, kept here only as the before figure. */
        const val VERSION_8_MAIN_LIST = """
            SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
            CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
            CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
            GROUP_CONCAT(tag.tag) AS tagsString
            FROM article AS art
            LEFT JOIN article_tags AS tag ON art.itemId = tag.itemId
            WHERE art.archived_at IS NULL AND art.deleted_at IS NULL
            GROUP BY art.itemId
            ORDER BY art.timeAdded DESC
        """
    }
}
