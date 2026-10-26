package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.room3.useReaderConnection
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * Runs `EXPLAIN QUERY PLAN` on the bundled SQLite engine (the one the app ships) for every
 * list, tag, lookup, sync and search query in [ArticleSql], the same text the DAO declares, and
 * checks that each one reads `article` through its index: the expected index is named, no
 * step reads `article` without an index, and the ordered lists and the sync pages need no
 * sort of their own. Unbound `:name` parameters are NULL here, which does not change the
 * index the planner picks.
 *
 * Every plan is printed and written to `build/reports/query-plans/article-queries.txt`.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ArticleQueryPlanTest {

    private lateinit var db: AppDatabase

    private data class Case(val name: String, val sql: String, val index: List<String>, val noSort: Boolean)

    private val cases = listOf(
        Case("MAIN_LIST", ArticleSql.MAIN_LIST, listOf("index_article_deleted_at_archived_at_timeAdded"), noSort = true),
        // Room's PagingSource wraps the list query this way for each page.
        Case(
            "MAIN_LIST (paged)",
            "SELECT * FROM (${ArticleSql.MAIN_LIST}) LIMIT 50 OFFSET 0",
            listOf("index_article_deleted_at_archived_at_timeAdded"),
            noSort = true,
        ),
        Case("FAVORITE_LIST", ArticleSql.FAVORITE_LIST, listOf("index_article_deleted_at_archived_at_timeFavorited_timeAdded"), noSort = true),
        Case("ARCHIVE_LIST", ArticleSql.ARCHIVE_LIST, listOf("index_article_deleted_at_archived_at_timeAdded"), noSort = true),
        Case("TAG_LIST_BY_TAG", ArticleSql.TAG_LIST_BY_TAG, listOf("index_article_tags_tag", "index_article_resolvedId"), noSort = false),
        Case("ALL_TAGS", ArticleSql.ALL_TAGS, listOf("index_article_resolvedId"), noSort = false),
        Case("CHANGED_SINCE_KEYSET", ArticleSql.CHANGED_SINCE_KEYSET, listOf("index_article_timeUpdated_itemId"), noSort = true),
        Case("COUNT_CHANGED_SINCE", ArticleSql.COUNT_CHANGED_SINCE, listOf("index_article_timeUpdated_itemId"), noSort = false),
        Case("NEVER_BACKED_UP", ArticleSql.NEVER_BACKED_UP, listOf("index_article_backed_up_at_deleted_at_timeAdded"), noSort = false),
        Case(
            "COUNT_NEVER_BACKED_UP",
            ArticleSql.COUNT_NEVER_BACKED_UP,
            listOf("index_article_backed_up_at_deleted_at_timeAdded"),
            noSort = false,
        ),
        Case("BY_RESOLVED_ID", ArticleSql.BY_RESOLVED_ID, listOf("index_article_resolvedId"), noSort = false),
        Case("BY_NORMALIZED_URL", ArticleSql.BY_NORMALIZED_URL, listOf("index_article_normalized_url"), noSort = false),
        Case("IMAGES_FOR_ARTICLES", ArticleSql.IMAGES_FOR_ARTICLES, listOf("index_article_images_itemId"), noSort = false),
        Case("AUTHORS_FOR_ARTICLES", ArticleSql.AUTHORS_FOR_ARTICLES, listOf("index_article_authors_itemId"), noSort = false),
        // The search reads the FTS5 index, then each matched article by its rowid; bm25 order
        // sorts the matched rows, so no no-sort check.
        Case("SEARCH_RANKED", ArticleSql.SEARCH_RANKED, listOf("article_fts VIRTUAL TABLE", "INTEGER PRIMARY KEY (rowid=?)"), noSort = false),
    )

    @Before
    fun setUp() {
        db = JvmRoomDatabase.create(RuntimeEnvironment.getApplication())
    }

    @After
    fun tearDown() {
        db.close()
    }

    /** 200 articles and 300 tags, so the plans are those of a filled library. */
    private suspend fun seed() {
        val dao = db.articleDao()
        dao.upsertArticles(
            (1..200).map { n ->
                Article(
                    itemId = "a$n",
                    resolvedId = "r$n",
                    title = "Article $n",
                    url = "https://example.com/a$n",
                    normalizedUrl = "example.com/a$n",
                    timeAdded = n * 10L,
                    timeUpdated = n * 10L,
                    timeFavorited = if (n % 10 == 0) n * 10L else 0,
                    archivedAt = if (n % 7 == 0) n * 10L else null,
                    deletedAt = if (n % 13 == 0) n * 10L else null,
                    backedUpAt = if (n % 3 == 0) null else n * 10L,
                )
            }
        )
        dao.insertArticleTags(
            (1..300).map { n -> ArticleTags(itemId = "a${n % 200 + 1}", tag = "tag${n % 15}", sortId = null, type = null) }
        )
    }

    private suspend fun plan(sql: String): List<String> = db.useReaderConnection { connection ->
        connection.usePrepared("EXPLAIN QUERY PLAN $sql") { s -> buildList { while (s.step()) add(s.getText(3)) } }
    }

    /** A step that reads `article` (aliases art, a) without an index or its rowid, or a bare scan of it. */
    private fun readsArticleWithoutIndex(line: String): Boolean {
        val match = Regex("^(SCAN|SEARCH) (article|art|a)\\b").find(line) ?: return false
        return match.value.isNotEmpty() && !line.contains("INDEX") && !line.contains("INTEGER PRIMARY KEY")
    }

    @Test
    fun everyListAndSyncQuery_readsArticleThroughItsIndex() = runTest {
        seed()

        val failures = mutableListOf<String>()
        val report = StringBuilder()
        for (case in cases) {
            val lines = plan(case.sql)
            report.append("== ${case.name}\n")
            lines.forEach { report.append("   $it\n") }
            for (index in case.index) {
                if (lines.none { it.contains(index) }) failures += "${case.name}: $index not used"
            }
            lines.filter(::readsArticleWithoutIndex).forEach { failures += "${case.name}: reads article without an index: $it" }
            if (case.noSort) {
                lines.filter { it.contains("USE TEMP B-TREE") }.forEach { failures += "${case.name}: sorts: $it" }
            }
        }

        println(report)
        val file = File("build/reports/query-plans/article-queries.txt")
        file.parentFile?.mkdirs()
        file.writeText(report.toString())

        assertTrue(failures.joinToString("\n", prefix = "query plans:\n") + "\n\n$report", failures.isEmpty())
    }

    @Test
    fun readsArticleWithoutIndex_flagsScansOnly() {
        assertTrue(readsArticleWithoutIndex("SCAN article"))
        assertTrue(readsArticleWithoutIndex("SCAN art"))
        assertTrue(readsArticleWithoutIndex("SEARCH a USING ROWID SEARCH ON TABLE article"))
        assertTrue(!readsArticleWithoutIndex("SEARCH art USING INDEX index_article_resolvedId (resolvedId=?)"))
        assertTrue(!readsArticleWithoutIndex("SCAN t USING COVERING INDEX index_article_tags_tag"))
        assertTrue(!readsArticleWithoutIndex("SEARCH article USING INTEGER PRIMARY KEY (rowid=?)"))
        assertTrue(!readsArticleWithoutIndex("SCAN article_fts VIRTUAL TABLE INDEX 0:M2"))
        assertTrue(!readsArticleWithoutIndex("SEARCH article_tags USING INDEX sqlite_autoindex_article_tags_1 (itemId=?)"))
    }
}
