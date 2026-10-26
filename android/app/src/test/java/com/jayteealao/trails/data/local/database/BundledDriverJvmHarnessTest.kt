package com.jayteealao.trails.data.local.database

import android.app.Application
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import com.jayteealao.trails.testing.JvmRoomDatabase
import kotlinx.coroutines.test.runTest
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
 * Proves that the app database runs on the host JVM: Room, the bundled SQLite engine and
 * Robolectric together. Later query tests build on [JvmRoomDatabase]; when this test fails,
 * they cannot run on the JVM either.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class BundledDriverJvmHarnessTest {

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

    @Test
    fun articles_roundTripThroughTheDao() = runTest {
        dao.upsertArticles(
            listOf(
                Article(itemId = "a1", title = "Growing roses in clay", url = "https://example.com/roses", timeAdded = 1),
                Article(itemId = "a2", title = "Pruning apple trees", url = "https://example.com/apples", timeAdded = 2),
            )
        )

        assertEquals("Growing roses in clay", dao.getArticleById("a1")?.title)
        assertEquals("Pruning apple trees", dao.getArticleById("a2")?.title)
        assertEquals(2, dao.countAllArticles())
    }

    @Test
    fun ftsSearch_matchesTheAppSearch() = runTest {
        dao.upsertArticles(
            listOf(
                Article(itemId = "a1", title = "Growing roses in clay", url = "https://example.com/roses", timeAdded = 1),
                Article(itemId = "a2", title = "Pruning apple trees", url = "https://example.com/apples", timeAdded = 2),
            )
        )

        val hits = dao.searchArticlesRanked("\"roses\"", 100)

        assertEquals(listOf("a1"), hits.map { it.itemId })
    }

    @Test
    fun bundledEngine_hasFts5() = runTest {
        val version = db.useWriterConnection { connection ->
            connection.executeSQL("CREATE VIRTUAL TABLE t USING fts5(x)")
            connection.usePrepared("SELECT sqlite_version()") { stmt ->
                stmt.step()
                stmt.getText(0)
            }
        }

        assertTrue("unexpected SQLite version $version", version.startsWith("3."))
    }
}
