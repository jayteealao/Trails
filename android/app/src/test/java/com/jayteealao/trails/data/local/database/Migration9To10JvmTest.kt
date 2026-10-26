package com.jayteealao.trails.data.local.database

import android.app.Application
import android.content.Context
import androidx.room3.Room
import androidx.room3.useReaderConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.jayteealao.trails.data.search.FtsMatchQuery
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * A version 9 library opens in the current app with every row intact and a search index
 * that holds every article again.
 *
 * The version 9 file is built on the host from the exported version 9 schema with the
 * bundled engine (its FTS4 triggers fill the old index as the rows go in), then opened
 * through [configureAppDatabase] exactly as the app opens it, so Room runs the 9 to 10
 * migration and validates every table against the current schema. The instrumented
 * [MigrationTest] case checks the same step on a device.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class Migration9To10JvmTest {

    private val dbName = "migration-9-10-jvm"
    private lateinit var context: Context
    private lateinit var schema9: JSONObject

    private val seededTables = listOf("article", "article_tags", "article_images", "article_authors", "local_archive")

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(dbName)
        context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).edit().clear().commit()
        schema9 = JSONObject(schemaFile(9).readText()).getJSONObject("database")
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun version9Library_migratesTo10_keepsEveryRow_andRebuildsTheSearchIndex() = runTest {
        val before = createVersion9Library()
        assertEquals(40, before.getValue("article").size)
        assertEquals(40, before.getValue("article_tags").size)
        assertEquals(1, before.getValue("article_images").size)
        assertEquals(1, before.getValue("article_authors").size)
        assertEquals(1, before.getValue("local_archive").size)

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            // The first DAO call opens the database: Room migrates 9 to 10 and validates the schema.
            // Every fifth article (5, 10, ..., 40) is deleted, so 32 are in the library.
            assertEquals(32, db.articleDao().countAllArticles())

            db.useReaderConnection { connection ->
                assertEquals(listOf("10"), connection.usePrepared("PRAGMA user_version") { it.texts() })
                // Every column of every row reads back unchanged.
                for ((table, rows) in before) {
                    val columns = columns(table)
                    val after = connection.usePrepared(selectAll(table, columns)) { it.rows(columns.size) }
                    assertEquals("rows of $table", rows, after)
                }
                assertEquals(
                    listOf("40"),
                    connection.usePrepared("SELECT COUNT(*) FROM article_fts_docsize") { it.texts() },
                )
                val ftsSql = connection.usePrepared("SELECT sql FROM sqlite_master WHERE name = 'article_fts'") { it.texts() }.single()
                assertTrue(ftsSql, ftsSql.contains("fts5", ignoreCase = true))
                assertEquals(
                    emptyList<String>(),
                    connection.usePrepared("SELECT name FROM sqlite_master WHERE name = 'article_fts_segments'") { it.texts() },
                )
            }
            assertEquals(
                listOf("a13"),
                db.articleDao().searchArticlesRanked(FtsMatchQuery.build("roses")!!, 100).map { it.itemId },
            )
        } finally {
            db.close()
        }
    }

    /** Creates the version 9 file from `9.json` and fills it; returns every row of each seeded table. */
    private fun createVersion9Library(): Map<String, List<List<String?>>> {
        val path = context.getDatabasePath(dbName)
        path.parentFile?.mkdirs()
        val connection = BundledSQLiteDriver().open(path.absolutePath)
        try {
            val entities = schema9.getJSONArray("entities")
            for (i in 0 until entities.length()) {
                val entity = entities.getJSONObject(i)
                val table = entity.getString("tableName")
                connection.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", table))
                entity.optJSONArray("indices")?.let { indices ->
                    for (j in 0 until indices.length()) {
                        connection.execSQL(indices.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}", table))
                    }
                }
                entity.optJSONArray("contentSyncTriggers")?.let { triggers ->
                    for (j in 0 until triggers.length()) connection.execSQL(triggers.getString(j))
                }
            }
            val setup = schema9.getJSONArray("setupQueries")
            for (i in 0 until setup.length()) connection.execSQL(setup.getString(i))
            connection.execSQL("PRAGMA user_version = 9")

            for (n in 1..40) connection.insertArticle(n)
            for (n in 1..40) connection.execSQL("INSERT INTO article_tags (itemId, tag, sortId, type) VALUES ('a$n', 'tag${n % 4}', $n, 'user')")
            connection.execSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('img1', 'a1', 'https://example.com/1.png', 640, 480, 'Ann', 'Caption 1')"
            )
            connection.execSQL(
                "INSERT INTO article_authors (authorId, itemId, name, url) VALUES ('au1', 'a1', 'Ann', 'https://example.com/ann')"
            )
            connection.execSQL(
                "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) " +
                    "VALUES ('a1', 'k1', '/archives/a1', 10, 20, 3000, 'complete')"
            )

            assertEquals(listOf("9"), connection.texts("PRAGMA user_version"))
            // The FTS4 triggers indexed every article.
            assertEquals(listOf("40"), connection.texts("SELECT COUNT(*) FROM article_fts_docsize"))
            return seededTables.associateWith { connection.dumpTable(it, columns(it)) }
        } finally {
            connection.close()
        }
    }

    /**
     * Article [n]: every fifth deleted, every fourth archived, every third favourite, all with
     * a normalized URL (so the open callback's URL backfill leaves them as they are). Article
     * 13's title holds the only "roses".
     */
    private fun SQLiteConnection.insertArticle(n: Int) {
        val deletedAt = if (n % 5 == 0) "${5_000 + n}" else "NULL"
        val archivedAt = if (n % 4 == 0) "${4_000 + n}" else "NULL"
        val favorite = if (n % 3 == 0) "'1'" else "NULL"
        val timeFavorited = if (n % 3 == 0) 3_000 + n else 0
        val title = if (n == 13) "Roses in winter" else "Title $n"
        execSQL(
            "INSERT INTO article (itemId, resolvedId, title, givenTitle, url, givenUrl, normalized_url, excerpt, " +
                "wordCount, favorite, status, hasImage, hasVideo, hasAudio, sortId, timeAdded, timeUpdated, timeFavorited, " +
                "listenDurationEstimate, text, articleId, resolved, deleted_at, archived_at, text_source, backed_up_at, " +
                "sync_failures) " +
                "VALUES ('a$n', 'r$n', '$title', '$title', 'https://example.com/a$n', " +
                "'https://example.com/a$n', 'example.com/a$n', 'About $n', 120, $favorite, '0', 1, 0, 0, $n, " +
                "${1_000 + n}, ${2_000 + n}, $timeFavorited, 60, 'Body of article $n', 'p$n', 1, $deletedAt, $archivedAt, 'warg', " +
                "${6_000 + n}, 0)"
        )
    }

    private fun columns(table: String): List<String> {
        val entities = schema9.getJSONArray("entities")
        for (i in 0 until entities.length()) {
            val entity = entities.getJSONObject(i)
            if (entity.getString("tableName") != table) continue
            val fields = entity.getJSONArray("fields")
            return (0 until fields.length()).map { fields.getJSONObject(it).getString("columnName") }
        }
        error("table $table is not in the version 9 schema")
    }

    private fun SQLiteConnection.dumpTable(table: String, columns: List<String>): List<List<String?>> =
        prepare(selectAll(table, columns)).use { it.rows(columns.size) }

    private fun selectAll(table: String, columns: List<String>): String {
        val list = columns.joinToString(", ") { "`$it`" }
        return "SELECT $list FROM `$table` ORDER BY $list"
    }

    private fun SQLiteStatement.rows(columnCount: Int): List<List<String?>> = buildList {
        while (step()) add((0 until columnCount).map { if (isNull(it)) null else getText(it) })
    }

    private fun SQLiteStatement.texts(): List<String> = buildList { while (step()) add(getText(0)) }

    private fun SQLiteConnection.texts(sql: String): List<String> = prepare(sql).use { it.texts() }

    /** The exported schema of [version]; Gradle runs unit tests from the module directory. */
    private fun schemaFile(version: Int): File {
        val relative = "schemas/com.jayteealao.trails.data.local.database.AppDatabase/$version.json"
        return listOf(File(relative), File("app/$relative")).firstOrNull { it.isFile }
            ?: error("schema $relative not found from ${File(".").absolutePath}")
    }
}
