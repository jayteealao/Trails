package com.jayteealao.trails.data.local.database

import android.app.Application
import android.content.Context
import androidx.room3.Room
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.jayteealao.trails.data.search.FtsMatchQuery
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
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
 * A version 10 library opens in the current app with its sync stamps and strike counters
 * moved to `sync_state`, every other value intact, each article's rowid unchanged and the
 * search index still valid.
 *
 * The version 10 file is built on the host from the exported version 10 schema with the
 * bundled engine, then opened through [configureAppDatabase] exactly as the app opens it, so
 * Room runs the 10 to 11 migration and validates every table against the current schema.
 * The instrumented [MigrationTest] case checks the same step on a device.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class Migration10To11JvmTest {

    private val dbName = "migration-10-11-jvm"
    private lateinit var context: Context
    private lateinit var schema10: JSONObject
    private lateinit var schema11: JSONObject

    private val otherTables = listOf("article_tags", "article_images", "article_authors", "local_archive")

    /** itemId to (backed_up_at, sync_failures) as seeded on version 10. */
    private val bookkeeping = linkedMapOf(
        "never" to (null to 0),
        "stamped" to (5_000L to 0),
        "struck" to (5_000L to 2),
        "atLimit" to (null to MAX_SYNC_FAILURES),
        "deleted" to (5_000L to 0),
        "long" to (null to 0),
    )

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(dbName)
        context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE).edit().clear().commit()
        schema10 = JSONObject(schemaFile(10).readText()).getJSONObject("database")
        schema11 = JSONObject(schemaFile(11).readText()).getJSONObject("database")
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun version10Library_migratesTo11_movesSyncBookkeeping_keepsRowsAndSearch() = runTest {
        val articleColumns = columns(schema11, "article")
        val before = createVersion10Library(articleColumns)

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            // The first DAO call opens the database: Room migrates 10 to 11 and validates the schema.
            // "deleted" is deleted, so 5 are in the library.
            assertEquals(5, db.articleDao().countAllArticles())

            db.useReaderConnection { connection ->
                assertEquals(listOf("11"), connection.usePrepared("PRAGMA user_version") { it.texts() })
                // Every other article column, and every other table, reads back unchanged.
                assertEquals(
                    "rows of article",
                    before.getValue("article"),
                    connection.usePrepared(selectAll("article", articleColumns)) { it.rows(articleColumns.size) },
                )
                for (table in otherTables) {
                    val columns = columns(schema10, table)
                    assertEquals(
                        "rows of $table",
                        before.getValue(table),
                        connection.usePrepared(selectAll(table, columns)) { it.rows(columns.size) },
                    )
                }
                // Each article keeps its rowid, so the external-content search index stays keyed.
                assertEquals(
                    before.getValue("rowids"),
                    connection.usePrepared("SELECT rowid, itemId FROM article ORDER BY itemId") { it.rows(2) },
                )
                // Only the rows with a stamp or a strike moved, with their values.
                assertEquals(
                    listOf(
                        listOf("atLimit", null, "3"),
                        listOf("deleted", "5000", "0"),
                        listOf("stamped", "5000", "0"),
                        listOf("struck", "5000", "2"),
                    ),
                    connection.usePrepared(
                        "SELECT itemId, backed_up_at, sync_failures FROM sync_state ORDER BY itemId"
                    ) { it.rows(3) },
                )
                assertEquals(
                    emptyList<String>(),
                    connection.usePrepared(
                        "SELECT name FROM pragma_table_info('article') WHERE name IN ('backed_up_at', 'sync_failures')"
                    ) { it.texts() },
                )
                assertEquals(
                    emptyList<String>(),
                    connection.usePrepared(
                        "SELECT name FROM sqlite_master WHERE name = 'index_article_backed_up_at_deleted_at_timeAdded'"
                    ) { it.texts() },
                )
            }
            // Raises an error when the index and the content table disagree.
            db.useWriterConnection { it.executeSQL("INSERT INTO article_fts(article_fts) VALUES('integrity-check')") }
            assertEquals(
                listOf("stamped"),
                db.articleDao().searchArticlesRanked(FtsMatchQuery.build("roses")!!, 100).map { it.itemId },
            )
            assertEquals(
                listOf("long"),
                db.articleDao().searchArticlesRanked(FtsMatchQuery.build("lantern")!!, 100).map { it.itemId },
            )
            // "never" and "long" have no stamp; "atLimit" is skipped.
            assertEquals(2, db.articleDao().countArticlesNeverBackedUp())
            assertEquals(1, db.articleDao().observeSyncFailureCount().first())
        } finally {
            db.close()
        }
    }

    /**
     * Creates the version 10 file from `10.json` and fills it; returns the rows to compare after
     * the migration: the article columns kept at version 11, the other tables, and the rowids.
     */
    private fun createVersion10Library(articleColumns: List<String>): Map<String, List<List<String?>>> {
        val path = context.getDatabasePath(dbName)
        path.parentFile?.mkdirs()
        val connection = BundledSQLiteDriver().open(path.absolutePath)
        try {
            val entities = schema10.getJSONArray("entities")
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
            val setup = schema10.getJSONArray("setupQueries")
            for (i in 0 until setup.length()) connection.execSQL(setup.getString(i))
            connection.execSQL("PRAGMA user_version = 10")

            bookkeeping.entries.forEachIndexed { index, (id, values) ->
                connection.insertArticle(index + 1, id, values.first, values.second)
            }
            for (id in bookkeeping.keys) {
                connection.execSQL("INSERT INTO article_tags (itemId, tag, sortId, type) VALUES ('$id', 'tag-$id', 1, 'user')")
            }
            connection.execSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('img1', 'stamped', 'https://example.com/1.png', 640, 480, 'Ann', 'Caption 1')"
            )
            connection.execSQL(
                "INSERT INTO article_authors (authorId, itemId, name, url) VALUES ('au1', 'stamped', 'Ann', 'https://example.com/ann')"
            )
            connection.execSQL(
                "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) " +
                    "VALUES ('stamped', 'k1', '/archives/stamped', 10, 20, 3000, 'complete')"
            )

            assertEquals(listOf("10"), connection.texts("PRAGMA user_version"))
            // The FTS5 triggers indexed every article, and the seeded word finds its article.
            assertEquals(
                listOf("stamped"),
                connection.texts("SELECT article.itemId FROM article_fts JOIN article ON article.rowid = article_fts.rowid WHERE article_fts MATCH 'roses'"),
            )
            val dump = otherTables.associateWith { connection.dumpTable(it, columns(schema10, it)) }.toMutableMap()
            dump["article"] = connection.dumpTable("article", articleColumns)
            dump["rowids"] = connection.prepare("SELECT rowid, itemId FROM article ORDER BY itemId").use { it.rows(2) }
            return dump
        } finally {
            connection.close()
        }
    }

    /**
     * Article [n] with [id] and its version 10 bookkeeping. "deleted" is deleted; "stamped"'s
     * title holds the only "roses"; "long" has a long text holding the only "lantern".
     */
    private fun SQLiteConnection.insertArticle(n: Int, id: String, backedUpAt: Long?, syncFailures: Int) {
        val deletedAt = if (id == "deleted") "${7_000 + n}" else "NULL"
        val title = if (id == "stamped") "Roses in winter" else "Title $n"
        val text = if (id == "long") (1..4_000).joinToString(" ") { "word$it" } + " lantern" else "Body of article $n"
        execSQL(
            "INSERT INTO article (itemId, resolvedId, title, givenTitle, url, givenUrl, normalized_url, excerpt, " +
                "wordCount, favorite, status, hasImage, hasVideo, hasAudio, sortId, timeAdded, timeUpdated, timeFavorited, " +
                "listenDurationEstimate, text, articleId, resolved, deleted_at, archived_at, text_source, backed_up_at, " +
                "sync_failures) " +
                "VALUES ('$id', 'r$n', '$title', '$title', 'https://example.com/$id', " +
                "'https://example.com/$id', 'example.com/$id', 'About $n', 120, NULL, '0', 1, 0, 0, $n, " +
                "${1_000 + n}, ${2_000 + n}, 0, 60, '$text', 'p$n', 1, $deletedAt, NULL, 'warg', " +
                "${backedUpAt ?: "NULL"}, $syncFailures)"
        )
    }

    private fun columns(schema: JSONObject, table: String): List<String> {
        val entities = schema.getJSONArray("entities")
        for (i in 0 until entities.length()) {
            val entity = entities.getJSONObject(i)
            if (entity.getString("tableName") != table) continue
            val fields = entity.getJSONArray("fields")
            return (0 until fields.length()).map { fields.getJSONObject(it).getString("columnName") }
        }
        error("table $table is not in the schema")
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
