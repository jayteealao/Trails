package com.jayteealao.trails.data.local.database

import android.app.Application
import android.content.Context
import androidx.room3.Room
import androidx.room3.useReaderConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
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
 * A version 7 library opens in the current app with every row intact and the new failed-push
 * counter at 0 on every article.
 *
 * The version 7 file is built on the host from the exported version 7 schema with the bundled
 * engine, then opened through [configureAppDatabase] exactly as the app opens it, so Room runs
 * the 7 to 8 migration and validates the result against the current schema. This runs on the
 * JVM; the instrumented [MigrationTest] case checks the same step on a device.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class Migration7To8JvmTest {

    private val dbName = "migration-7-8-jvm"
    private lateinit var context: Context
    private lateinit var schema7: JSONObject

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(dbName)
        context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).edit().clear().commit()
        schema7 = JSONObject(schemaFile(7).readText()).getJSONObject("database")
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun version7Library_migratesTo8_keepsEveryRow_andCounterIsZero() = runTest {
        val before = createVersion7Library()
        assertEquals(3, before.getValue("article").size)
        assertEquals(2, before.getValue("article_tags").size)
        assertEquals(1, before.getValue("article_images").size)

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            // The first DAO call opens the database: Room migrates 7 to 8 and validates the schema.
            // The library count leaves out the deleted row a2.
            assertEquals(2, db.articleDao().countAllArticles())

            db.useReaderConnection { connection ->
                // Every version 7 column of every row reads back unchanged.
                for ((table, rows) in before) {
                    val columns = version7Columns(table)
                    val after = connection.usePrepared(selectAllAfter(table, columns)) { it.rows(columns.size) }
                    assertEquals("rows of $table", rows, after)
                }
                assertEquals(
                    listOf("0", "0", "0"),
                    connection.usePrepared(
                        "SELECT IFNULL(s.sync_failures, 0) FROM article " +
                            "LEFT JOIN sync_state AS s ON s.itemId = article.itemId ORDER BY article.itemId"
                    ) { it.texts() },
                )
                // The production configuration runs every later step too, so the file ends at the current version.
                assertEquals(listOf("11"), connection.usePrepared("PRAGMA user_version") { it.texts() })
            }
        } finally {
            db.close()
        }
    }

    /** Creates the version 7 file from `7.json` and fills it; returns every row of each seeded table. */
    private fun createVersion7Library(): Map<String, List<List<String?>>> {
        val path = context.getDatabasePath(dbName)
        path.parentFile?.mkdirs()
        val connection = BundledSQLiteDriver().open(path.absolutePath)
        try {
            val entities = schema7.getJSONArray("entities")
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
            val setup = schema7.getJSONArray("setupQueries")
            for (i in 0 until setup.length()) connection.execSQL(setup.getString(i))
            connection.execSQL("PRAGMA user_version = 7")

            // normalized_url is filled, so the open callback's URL backfill leaves the rows as they are.
            connection.insertArticle("a1", "Growing roses", deletedAt = null, backedUpAt = null)
            connection.insertArticle("a2", "Pruning apple trees", deletedAt = 5_000, backedUpAt = null)
            connection.insertArticle("a3", "Birch bark notes", deletedAt = null, backedUpAt = 4_000)
            connection.execSQL("INSERT INTO article_tags (itemId, tag, sortId, type) VALUES ('a1', 'garden', 1, 'user')")
            connection.execSQL("INSERT INTO article_tags (itemId, tag) VALUES ('a3', 'trees')")
            connection.execSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('img1', 'a1', 'https://example.com/roses.png', 640, 480, 'Ann', 'Roses')"
            )

            assertEquals(listOf("7"), connection.texts("PRAGMA user_version"))
            return listOf("article", "article_tags", "article_images")
                .associateWith { connection.dumpTable(it, version7Columns(it)) }
        } finally {
            connection.close()
        }
    }

    private fun SQLiteConnection.insertArticle(itemId: String, title: String, deletedAt: Long?, backedUpAt: Long?) {
        execSQL(
            "INSERT INTO article (itemId, resolvedId, title, givenTitle, url, givenUrl, normalized_url, excerpt, " +
                "wordCount, status, hasImage, hasVideo, hasAudio, sortId, timeAdded, timeUpdated, timeFavorited, " +
                "listenDurationEstimate, text, articleId, resolved, deleted_at, text_source, backed_up_at) " +
                "VALUES ('$itemId', 'r-$itemId', '$title', '$title', 'https://example.com/$itemId', " +
                "'https://example.com/$itemId', 'example.com/$itemId', 'About $title', 120, '0', 1, 0, 0, 3, " +
                "1000, 2000, 0, 60, 'Body of $title', 'p-$itemId', 1, ${deletedAt ?: "NULL"}, 'warg', " +
                "${backedUpAt ?: "NULL"})"
        )
    }

    private fun version7Columns(table: String): List<String> {
        val entities = schema7.getJSONArray("entities")
        for (i in 0 until entities.length()) {
            val entity = entities.getJSONObject(i)
            if (entity.getString("tableName") != table) continue
            val fields = entity.getJSONArray("fields")
            return (0 until fields.length()).map { fields.getJSONObject(it).getString("columnName") }
        }
        error("table $table is not in the version 7 schema")
    }

    /** Every row of [table] as text, ordered by all of [columns]. */
    private fun SQLiteConnection.dumpTable(table: String, columns: List<String>): List<List<String?>> =
        prepare(selectAll(table, columns)).use { it.rows(columns.size) }
            .also { assertTrue("no rows in $table", it.isNotEmpty()) }

    private fun selectAll(table: String, columns: List<String>): String {
        val list = columns.joinToString(", ") { "`$it`" }
        return "SELECT $list FROM `$table` ORDER BY $list"
    }

    /**
     * [selectAll] on the current schema: the sync stamp and the counter of `article` are read
     * from `sync_state` (moved there at version 11), in the same column order, so the rows
     * compare with the dump taken before the migration.
     */
    private fun selectAllAfter(table: String, columns: List<String>): String {
        if (table != "article") return selectAll(table, columns)
        val list = columns.joinToString(", ") {
            when (it) {
                "backed_up_at" -> "s.backed_up_at"
                "sync_failures" -> "IFNULL(s.sync_failures, 0)"
                else -> "article.`$it`"
            }
        }
        return "SELECT $list FROM article LEFT JOIN sync_state AS s ON s.itemId = article.itemId ORDER BY $list"
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
