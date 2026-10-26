package com.jayteealao.trails.data.local.database

import android.content.Context
import android.util.Log
import androidx.room3.Room
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jayteealao.trails.data.SEARCH_RESULT_LIMIT
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.search.FtsMatchQuery
import com.jayteealao.trails.testing.SearchCorpus
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Records how long a search takes on 5,000 articles ([SearchCorpus]) on the device, through
 * a file database opened exactly as the app opens it ([configureAppDatabase]). This is the
 * figure the 200 ms search budget applies to.
 *
 * Each input: 3 warm-up and [TIMED] timed calls, median and p90 in milliseconds. One JSON
 * line per input goes to logcat under the tag [TAG].
 */
@RunWith(AndroidJUnit4::class)
class SearchBenchmarkTest {

    private val dbName = "search-benchmark"
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var db: AppDatabase

    @Before
    fun setUp() {
        context.deleteDatabase(dbName)
        db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
    }

    @After
    fun tearDown() {
        db.close()
        context.deleteDatabase(dbName)
    }

    /** The search as the app runs it: the typed words as one OR match, ranked and limited in SQL. */
    private suspend fun search(input: String): List<ArticleItem> =
        FtsMatchQuery.build(input)?.let { db.articleDao().searchArticlesRanked(it, SEARCH_RESULT_LIMIT) } ?: emptyList()

    /** Time of the index rebuild the 9 to 10 migration runs, on the seeded library. */
    private suspend fun rebuildMs(): Double = db.useWriterConnection { connection ->
        val start = System.nanoTime()
        connection.executeSQL("INSERT INTO article_fts(article_fts) VALUES('rebuild')")
        (System.nanoTime() - start) / 1_000_000.0
    }

    private suspend fun time(input: String): JSONObject {
        repeat(3) { search(input) }
        var rows = 0
        val ms = (1..TIMED).map {
            val start = System.nanoTime()
            rows = search(input).size
            (System.nanoTime() - start) / 1_000_000.0
        }.sorted()
        assertTrue("at most $SEARCH_RESULT_LIMIT rows for $input: $rows", rows <= SEARCH_RESULT_LIMIT)
        return JSONObject()
            .put("input", input)
            .put("rows", rows)
            .put("medianMs", (ms[TIMED / 2 - 1] + ms[TIMED / 2]) / 2)
            .put("p90Ms", ms[(TIMED * 9 + 9) / 10 - 1])
            .put("iterations", TIMED)
    }

    @Test
    fun searchOnFiveThousandArticles_isRecorded() = runBlocking<Unit> {
        val articles = SearchCorpus.articles()
        val seedStart = System.nanoTime()
        db.articleDao().upsertArticles(articles)
        val seedMs = (System.nanoTime() - seedStart) / 1_000_000.0
        val sqliteVersion = db.useReaderConnection { c -> c.usePrepared("SELECT sqlite_version()") { it.step(); it.getText(0) } }

        SearchCorpus.INPUTS.forEach { input ->
            val entry = time(input)
                .put("path", PATH)
                .put("engine", "bundled SQLite (device)")
                .put("sqliteVersion", sqliteVersion)
                .put("articles", articles.size)
                .put("seedMs", seedMs)
            Log.i(TAG, entry.toString())
        }
        val rebuild = JSONObject()
            .put("measure", "index rebuild")
            .put("rebuildMs", rebuildMs())
            .put("engine", "bundled SQLite (device)")
            .put("sqliteVersion", sqliteVersion)
            .put("articles", articles.size)
        Log.i(TAG, rebuild.toString())
    }

    private companion object {
        const val TAG = "SearchBenchmark"
        const val TIMED = 10
        const val PATH = "version 10: FTS5 OR match, bm25 order and limit in SQL"
    }
}
