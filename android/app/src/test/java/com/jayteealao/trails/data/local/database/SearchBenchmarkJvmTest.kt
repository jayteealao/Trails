package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import com.jayteealao.trails.data.SEARCH_RESULT_LIMIT
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.search.FtsMatchQuery
import com.jayteealao.trails.testing.JvmRoomDatabase
import com.jayteealao.trails.testing.SearchCorpus
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import kotlin.time.Duration.Companion.minutes

/**
 * Records how long a search takes on 5,000 articles ([SearchCorpus]) on the host's bundled
 * SQLite engine, the same engine the app ships. The numbers are recorded, not gated; the
 * device figure from the instrumented benchmark is the one the 200 ms budget applies to.
 *
 * Each input is searched exactly as the app's search runs it: 3 warm-up and [TIMED] timed
 * calls, median and p90 in milliseconds. Written to `build/reports/benchmark/search.json`.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class SearchBenchmarkJvmTest {

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

    /** The search as the app runs it: the typed words as one OR match, ranked and limited in SQL. */
    private suspend fun search(input: String): List<ArticleItem> =
        FtsMatchQuery.build(input)?.let { dao.searchArticlesRanked(it, SEARCH_RESULT_LIMIT) } ?: emptyList()

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
    fun searchOnFiveThousandArticles_isRecorded() = runTest(timeout = 10.minutes) {
        val articles = SearchCorpus.articles()
        val seedStart = System.nanoTime()
        dao.upsertArticles(articles)
        val seedMs = (System.nanoTime() - seedStart) / 1_000_000.0
        println("seeded ${articles.size} articles in $seedMs ms")
        val sqliteVersion = db.useReaderConnection { c -> c.usePrepared("SELECT sqlite_version()") { it.step(); it.getText(0) } }

        val report = JSONArray()
        SearchCorpus.INPUTS.forEach { input ->
            report.put(
                time(input)
                    .put("path", PATH)
                    .put("engine", "bundled SQLite (JVM)")
                    .put("sqliteVersion", sqliteVersion)
                    .put("articles", articles.size)
                    .put("seedMs", seedMs)
            )
        }
        report.put(
            JSONObject()
                .put("measure", "index rebuild")
                .put("rebuildMs", rebuildMs())
                .put("engine", "bundled SQLite (JVM)")
                .put("sqliteVersion", sqliteVersion)
                .put("articles", articles.size)
        )
        val text = report.toString(2)
        println(text)
        val file = File("build/reports/benchmark/search.json")
        file.parentFile?.mkdirs()
        file.writeText(text)
    }

    private companion object {
        const val TIMED = 10
        const val PATH = "version 10: FTS5 OR match, bm25 order and limit in SQL"
    }
}
