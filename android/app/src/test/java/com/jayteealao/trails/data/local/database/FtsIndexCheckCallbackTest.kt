package com.jayteealao.trails.data.local.database

import android.app.Application
import android.content.Context
import androidx.room3.Room
import androidx.room3.useReaderConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.jayteealao.trails.data.search.FtsMatchQuery
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
import timber.log.Timber

/**
 * When the search index holds fewer rows than `article` (a missed backfill, rowid drift),
 * opening the database rebuilds it, so every article is searchable again. When the counts
 * match, opening rebuilds nothing.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class FtsIndexCheckCallbackTest {

    private val dbName = "fts-index-check"
    private lateinit var context: Context
    private val tree = RecordingTree()

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(dbName)
        context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).edit().clear().commit()
        Timber.plant(tree)
    }

    @After
    fun tearDown() {
        Timber.uproot(tree)
        context.deleteDatabase(dbName)
    }

    private fun appDatabase(): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, dbName).configureAppDatabase(context).build()

    /** The app's engine and migrations, but no open callback that checks the index. */
    private fun databaseWithoutCheck(): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .setDriver(BundledSQLiteDriver())
            .addMigrations(*ALL_MIGRATIONS)
            .build()

    /** 20 articles; article 7's title holds the only "saffron". */
    private suspend fun seedAndClose() {
        val db = appDatabase()
        db.articleDao().upsertArticles(
            (1..20).map { n ->
                Article(
                    itemId = "a$n",
                    title = if (n == 7) "Saffron fields" else "Article $n",
                    url = "https://example.com/a$n",
                    normalizedUrl = "example.com/a$n",
                    text = "Body of article $n",
                    timeAdded = n.toLong(),
                    timeUpdated = n.toLong(),
                )
            }
        )
        db.close()
    }

    /** Removes article 7 from the search index only, with the FTS5 delete command. */
    private fun dropArticle7FromIndex() {
        val connection = BundledSQLiteDriver().open(context.getDatabasePath(dbName).absolutePath)
        try {
            val (rowid, title, text) = connection.prepare("SELECT rowid, title, text FROM article WHERE itemId = 'a7'").use {
                it.step()
                Triple(it.getLong(0), it.getText(1), it.getText(2))
            }
            connection.prepare("INSERT INTO article_fts(article_fts, rowid, title, text) VALUES('delete', ?, ?, ?)").use {
                it.bindLong(1, rowid)
                it.bindText(2, title)
                it.bindText(3, text)
                it.step()
            }
            assertEquals(19L, connection.prepare("SELECT COUNT(*) FROM article_fts_docsize").use { it.step(); it.getLong(0) })
        } finally {
            connection.close()
        }
    }

    private suspend fun AppDatabase.indexedRows(): Long =
        useReaderConnection { c -> c.usePrepared("SELECT COUNT(*) FROM article_fts_docsize") { it.step(); it.getLong(0) } }

    @Test
    fun indexShortOfArticles_isRebuiltOnOpen() = runTest {
        seedAndClose()
        dropArticle7FromIndex()

        val db = appDatabase()
        try {
            assertEquals(20, db.articleDao().countAllArticles())
            assertEquals(20L, db.indexedRows())
            assertEquals(listOf("a7"), db.articleDao().searchArticlesRanked(FtsMatchQuery.build("saffron")!!, 100).map { it.itemId })
            assertTrue(tree.messages.toString(), tree.messages.any { it.startsWith(REBUILD_LOG) })
        } finally {
            db.close()
        }
    }

    @Test
    fun indexInStep_isNotRebuilt() = runTest {
        seedAndClose()
        tree.messages.clear()

        val db = appDatabase()
        try {
            assertEquals(20, db.articleDao().countAllArticles())
            assertEquals(20L, db.indexedRows())
            assertTrue(tree.messages.toString(), tree.messages.none { it.startsWith(REBUILD_LOG) })
        } finally {
            db.close()
        }
    }

    @Test
    fun withoutTheCheck_theIndexStaysShort() = runTest {
        seedAndClose()
        dropArticle7FromIndex()

        val db = databaseWithoutCheck()
        try {
            assertEquals(20, db.articleDao().countAllArticles())
            assertEquals(19L, db.indexedRows())
        } finally {
            db.close()
        }
    }

    private class RecordingTree : Timber.Tree() {
        val messages = mutableListOf<String>()
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            messages += message
        }
    }

    private companion object {
        /** The start of the line [FtsIndexCheckCallback] logs when it rebuilds. */
        const val REBUILD_LOG = "Search index rebuilt"
    }
}
