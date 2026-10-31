package com.jayteealao.trails.data.local.database

import android.content.Context
import androidx.room3.Room
import androidx.room3.testing.MigrationTestHelper
import androidx.room3.useReaderConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jayteealao.trails.data.search.FtsMatchQuery
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A library saved by the version 7 app opens in the current app with every row intact and
 * the same search results.
 *
 * The file is created from the exported version 7 schema, filled with a small library, and
 * then opened through [configureAppDatabase], exactly as the app opens its database.
 */
@RunWith(AndroidJUnit4::class)
class UpgradeFromVersion7Test {

    private val dbName = "upgrade-from-7"
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val tables = listOf("article", "article_tags", "article_images", "article_authors", "local_archive")
    private val searchPattern = "*\"*roses*\"*" // the pattern the app's search builds for "roses"

    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        context.getDatabasePath(dbName),
        BundledSQLiteDriver(),
        AppDatabase::class,
    )

    @Before
    fun startClean() {
        context.deleteDatabase(dbName)
        context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun version7Library_opensWithEveryRowAndTheSameSearchResults() = runBlocking {
        val before: Map<String, Long>
        val searchBefore: List<String>
        helper.createDatabase(7).use { db ->
            db.seedLibrary()
            before = tables.associateWith { db.long("SELECT COUNT(*) FROM $it") }
            searchBefore = db.texts(
                "SELECT article.itemId FROM article JOIN article_fts ON article.itemId = article_fts.itemId " +
                    "WHERE article_fts MATCH '$searchPattern' ORDER BY article.itemId"
            )
        }
        assertEquals(mapOf("article" to 20L, "article_tags" to 30L, "article_images" to 5L, "article_authors" to 2L, "local_archive" to 1L), before)
        assertEquals(listOf("a03", "a13"), searchBefore)

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            val searchAfter = db.articleDao().searchArticlesRanked(FtsMatchQuery.build("roses")!!, 100).map { it.itemId }.sorted()
            val after = db.useReaderConnection { connection ->
                tables.associateWith { table ->
                    connection.usePrepared("SELECT COUNT(*) FROM $table") { it.step(); it.getLong(0) }
                }
            }

            assertEquals(before, after)
            assertEquals(searchBefore, searchAfter)
            assertTrue(
                context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).getBoolean(UrlNormalizationCallback.URL_NORMALIZATION_V2, false)
            )
        } finally {
            db.close()
        }
    }

    /** 20 articles (two titles contain "roses"), 30 tags, 5 images, 2 authors, 1 archive. */
    private fun SQLiteConnection.seedLibrary() {
        val words = listOf("apples", "birch", "cedar", "roses", "elm", "ferns", "ginkgo", "holly", "iris", "juniper")
        for (i in 0 until 20) {
            val id = "a%02d".format(i)
            val title = "Notes on ${words[i % words.size]} number $i"
            execSQL(
                "INSERT INTO article (itemId, title, givenTitle, url, wordCount, status, hasImage, hasVideo, hasAudio, " +
                    "sortId, timeAdded, timeUpdated, timeFavorited, listenDurationEstimate) " +
                    "VALUES ('$id', '$title', '$title', 'https://example.com/$id', 0, '0', 0, 0, 0, $i, ${1000 + i}, ${1000 + i}, 0, 0)"
            )
        }
        for (i in 0 until 30) {
            execSQL("INSERT INTO article_tags (itemId, tag) VALUES ('${"a%02d".format(i % 20)}', 'tag$i')")
        }
        for (i in 0 until 5) {
            execSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('img$i', 'a0$i', 'https://example.com/$i.png', 10, 10, '', '')"
            )
        }
        for (i in 0 until 2) {
            execSQL("INSERT INTO article_authors (authorId, itemId, name, url) VALUES ('au$i', 'a0$i', 'Author $i', 'https://example.com/au$i')")
        }
        execSQL(
            "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) " +
                "VALUES ('a00', 'k', '/archives/a00', 1, 2, 3, 'complete')"
        )
        execSQL("INSERT INTO article_fts(article_fts) VALUES ('rebuild')")
    }

    private fun SQLiteConnection.long(sql: String): Long = prepare(sql).use { it.step(); it.getLong(0) }

    private fun SQLiteConnection.texts(sql: String): List<String> = prepare(sql).use {
        buildList { while (it.step()) add(it.getText(0)) }
    }
}
