package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.search.FtsMatchQuery
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The ranked search query on a real in-memory database on the bundled SQLite engine (the
 * engine the app ships): any typed word matches, quoted phrases match as phrases, results
 * come best first by bm25, at most the limit, never a deleted article, and the index
 * follows inserts, updates and deletes of `article`.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class Fts5SearchQueryTest {

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

    private fun article(itemId: String, title: String, text: String, deletedAt: Long? = null) = Article(
        itemId = itemId,
        title = title,
        url = "https://example.com/$itemId",
        text = text,
        timeAdded = 1_600_000_000_000,
        timeUpdated = 1_600_000_000_000,
        deletedAt = deletedAt,
    )

    /** Filler words that none of the searches below match. */
    private fun filler(n: Int, words: Int) =
        (0 until words).joinToString(" ") { listOf("zeta", "quill", "fjord", "basalt", "tundra", "moss", "pebble")[(n + it) % 7] }

    private suspend fun seed() {
        val rows = mutableListOf<Article>()
        (1..60).mapTo(rows) { article("f$it", "Filler ${filler(it, 3)}", filler(it, 40)) }
        rows += article("best", "River mill", "The river turns the mill. River water, mill stones, river, mill. ${filler(1, 10)}")
        rows += article("river1", "Notes one", "${filler(2, 80)} river ${filler(3, 80)}")
        rows += article("mill1", "Notes two", "${filler(4, 60)} mill ${filler(5, 60)}")
        rows += article("phrase", "Notes three", "We walked the old mill road at dawn")
        rows += article("apart", "Notes four", "Old stones lay by the mill")
        rows += article("gone", "River mill river mill", "river mill river mill river mill", deletedAt = 1_700_000_000_000)
        rows += article("ops", "NEAR AND OR", filler(6, 5))
        rows += article("ab", "a b", filler(7, 5))
        rows += article("runner", "Notes five", "I run every morning")
        rows += article("accent", "Café notes", filler(8, 5))
        (1..150).mapTo(rows) { article("lantern$it", "Lantern $it", "A lantern ${filler(it, 5 + it % 20)}") }
        dao.upsertArticles(rows)
    }

    private suspend fun search(input: String, limit: Int = 100): List<ArticleItem> =
        dao.searchArticlesRanked(FtsMatchQuery.build(input)!!, limit)

    private suspend fun ids(input: String) = search(input).map { it.itemId }

    /** The live matches of [match] in ascending bm25 order, read by a separate raw query. */
    private suspend fun rawBm25Order(match: String): List<String> = db.useReaderConnection { connection ->
        connection.usePrepared(
            "SELECT article.itemId FROM article_fts JOIN article ON article.rowid = article_fts.rowid " +
                "WHERE article_fts MATCH ? AND article.deleted_at IS NULL ORDER BY bm25(article_fts)"
        ) { statement ->
            statement.bindText(1, match)
            buildList { while (statement.step()) add(statement.getText(0)) }
        }
    }

    @Test
    fun operatorWordsAndSymbols_raiseNoError_andMatchAsLiteralWords() = runTest {
        seed()
        for (input in listOf("\"", "*", "-", "NEAR", "AND", "OR", "a\"b")) search(input)
        assertEquals(listOf("ops"), ids("NEAR"))
        assertEquals(listOf("ops"), ids("AND"))
        assertEquals(listOf("ops"), ids("OR"))
        assertEquals(listOf("ab"), ids("a\"b"))
    }

    @Test
    fun twoWords_returnEitherWord_bestFirstByBm25_withoutDeleted() = runTest {
        seed()
        val results = ids("river mill")
        assertTrue(results.toString(), results.containsAll(listOf("best", "river1", "mill1", "phrase", "apart")))
        assertTrue(results.all { it in setOf("best", "river1", "mill1", "phrase", "apart") })
        assertEquals("best", results.first())
        assertEquals(rawBm25Order(FtsMatchQuery.build("river mill")!!), results)
    }

    @Test
    fun manyMatches_returnAtMostTheLimit() = runTest {
        seed()
        assertEquals(100, search("lantern").size)
    }

    @Test
    fun quotedPhrase_returnsOnlyPhraseMatches() = runTest {
        seed()
        assertEquals(listOf("phrase"), ids("\"old mill\""))
    }

    @Test
    fun deletedArticle_isNeverReturned() = runTest {
        seed()
        for (input in listOf("river", "mill", "river mill", "\"river mill\"")) {
            assertFalse("gone in <$input>", "gone" in ids(input))
        }
    }

    @Test
    fun index_followsUpdateAndDelete() = runTest {
        seed()
        assertTrue("river1" in ids("river"))

        dao.upsertArticle(article("river1", "Notes one", "${filler(2, 80)} harbor ${filler(3, 80)}"))
        assertFalse("river1" in ids("river"))
        assertEquals(listOf("river1"), ids("harbor"))

        db.useWriterConnection { it.executeSQL("DELETE FROM article WHERE itemId = 'mill1'") }
        assertFalse("mill1" in ids("mill"))

        // Raises an error when the index and the content table disagree.
        db.useWriterConnection { it.executeSQL("INSERT INTO article_fts(article_fts, rank) VALUES('integrity-check', 1)") }
    }

    @Test
    fun snippet_boldsTheMatchedWord() = runTest {
        seed()
        val snippet = search("river mill").first { it.itemId == "best" }.snippet.orEmpty()
        assertTrue(snippet, Regex("<b>(river|mill)</b>", RegexOption.IGNORE_CASE).containsMatchIn(snippet))
    }

    @Test
    fun stemmingAndDiacritics_matchWordForms() = runTest {
        seed()
        assertEquals(listOf("runner"), ids("running"))
        assertEquals(listOf("accent"), ids("cafe"))
    }
}
