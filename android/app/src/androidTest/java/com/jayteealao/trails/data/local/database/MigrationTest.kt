package com.jayteealao.trails.data.local.database

import androidx.room3.testing.MigrationTestHelper
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs every hand-written migration on the bundled SQLite engine and validates the result
 * against the exported schema of the next version, with a representative row carried through.
 *
 * Later schema versions add one test per migration here and extend [migrate1To10_chain].
 */
@RunWith(AndroidJUnit4::class)
class MigrationTest {

    private val dbName = "migration-test"

    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        InstrumentationRegistry.getInstrumentation().targetContext.getDatabasePath(dbName),
        BundledSQLiteDriver(),
        AppDatabase::class,
    )

    /** The helper does not remove the file between tests; each test starts from no database. */
    @Before
    fun deleteDatabase() {
        InstrumentationRegistry.getInstrumentation().targetContext.deleteDatabase(dbName)
    }

    @Test
    fun migrate1To2_tagsKeyedByArticleAndTag() = runBlocking {
        helper.createDatabase(1).use { db ->
            db.insertArticle("PocketArticle", "a1", "Growing roses")
            db.execSQL("INSERT INTO PocketTags (itemId, tag) VALUES ('a1', 'garden')")
        }

        helper.runMigrationsAndValidate(2, listOf(MIGRATION_1_2)).use { db ->
            // The new key accepts a second tag on the same article.
            db.execSQL("INSERT INTO pockettags (itemId, tag) VALUES ('a1', 'flowers')")
            assertEquals(listOf("flowers", "garden"), db.texts("SELECT tag FROM pockettags WHERE itemId = 'a1' ORDER BY tag"))
            assertEquals(1L, db.long("SELECT COUNT(*) FROM PocketArticle"))
        }
    }

    @Test
    fun migrate2To3_addsDeletedAndArchivedColumns() = runBlocking {
        helper.createDatabase(2).use { db -> db.insertArticle("PocketArticle", "a1", "Growing roses") }

        helper.runMigrationsAndValidate(3, listOf(MIGRATION_2_3)).use { db ->
            assertEquals(1L, db.long("SELECT COUNT(*) FROM PocketArticle WHERE deleted_at IS NULL AND archived_at IS NULL"))
        }
    }

    @Test
    fun migrate3To4_renamesTablesAndRebuildsSearch() = runBlocking {
        helper.createDatabase(3).use { db ->
            db.insertArticle("PocketArticle", "a1", "Growing roses", pocketId = "p1")
            db.execSQL("INSERT INTO PocketTags (itemId, tag) VALUES ('a1', 'garden')")
            db.execSQL("INSERT INTO PocketImages (imageId, itemId, src, width, height, credit, caption) VALUES ('i1', 'a1', 'https://example.com/i.png', 1, 1, '', '')")
            db.execSQL("INSERT INTO PocketAuthors (authorId, itemId, name, url) VALUES ('au1', 'a1', 'Ann', 'https://example.com/ann')")
            db.execSQL("INSERT INTO PocketVideos (videoId, itemId, src, width, height, type, vid) VALUES ('v1', 'a1', 'https://example.com/v', 1, 1, 'yt', 'x')")
        }

        helper.runMigrationsAndValidate(4, listOf(MIGRATION_3_4)).use { db ->
            assertEquals(listOf("p1"), db.texts("SELECT articleId FROM article WHERE itemId = 'a1'"))
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article_tags"))
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article_images"))
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article_authors"))
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article_videos"))
            assertEquals(listOf("a1"), db.searchTitle("roses"))
        }
    }

    @Test
    fun migrate4To5_addsTextSourceAndLocalArchive() = runBlocking {
        helper.createDatabase(4).use { db -> db.insertArticle("article", "a1", "Growing roses") }

        helper.runMigrationsAndValidate(5, listOf(MIGRATION_4_5)).use { db ->
            assertEquals(listOf(""), db.texts("SELECT text_source FROM article WHERE itemId = 'a1'"))
            db.execSQL(
                "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt) " +
                    "VALUES ('a1', 'k', '/p', 1, 2, 3)"
            )
            assertEquals(listOf("complete"), db.texts("SELECT status FROM local_archive"))
        }
    }

    @Test
    fun migrate5To6_addsNormalizedUrl() = runBlocking {
        helper.createDatabase(5).use { db -> db.insertArticle("article", "a1", "Growing roses") }

        helper.runMigrationsAndValidate(6, listOf(MIGRATION_5_6)).use { db ->
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article WHERE normalized_url IS NULL"))
        }
    }

    @Test
    fun migrate6To7_addsBackedUpAt() = runBlocking {
        helper.createDatabase(6).use { db -> db.insertArticle("article", "a1", "Growing roses") }

        helper.runMigrationsAndValidate(7, listOf(MIGRATION_6_7)).use { db ->
            assertEquals(1L, db.long("SELECT COUNT(*) FROM article WHERE backed_up_at IS NULL"))
        }
    }

    @Test
    fun migrate7To8_keepsRowsAndAddsCounter() = runBlocking {
        helper.createDatabase(7).use { db ->
            db.insertArticle("article", "a1", "Growing roses")
            db.insertArticle("article", "a2", "Pruning apple trees")
            db.execSQL("UPDATE article SET backed_up_at = 4000, deleted_at = 5000 WHERE itemId = 'a2'")
            db.execSQL("INSERT INTO article_fts(article_fts) VALUES ('rebuild')")
        }

        helper.runMigrationsAndValidate(8, listOf(MIGRATION_7_8)).use { db ->
            assertEquals(listOf("a1", "a2"), db.texts("SELECT itemId FROM article ORDER BY itemId"))
            assertEquals(
                listOf("Growing roses", "Pruning apple trees"),
                db.texts("SELECT title FROM article ORDER BY itemId"),
            )
            assertEquals(listOf("4000"), db.texts("SELECT backed_up_at FROM article WHERE deleted_at = 5000"))
            assertEquals(listOf("0", "0"), db.texts("SELECT sync_failures FROM article ORDER BY itemId"))
            assertEquals(listOf("a1"), db.searchTitle("roses"))
        }
    }

    @Test
    fun migrate8To9_keepsRowsAndAddsIndexes() = runBlocking {
        helper.createDatabase(8).use { db ->
            db.insertArticle("article", "a1", "Growing roses")
            db.insertArticle("article", "a2", "Pruning apple trees")
            db.execSQL("UPDATE article SET resolvedId = 'r2', normalized_url = 'example.com/a2', deleted_at = 5000 WHERE itemId = 'a2'")
            db.execSQL("INSERT INTO article_tags (itemId, tag) VALUES ('a1', 'garden')")
        }

        helper.runMigrationsAndValidate(9, listOf(MIGRATION_8_9)).use { db ->
            assertEquals(listOf("a1", "a2"), db.texts("SELECT itemId FROM article ORDER BY itemId"))
            assertEquals(
                listOf("Growing roses", "Pruning apple trees"),
                db.texts("SELECT title FROM article ORDER BY itemId"),
            )
            assertEquals(listOf("r2"), db.texts("SELECT resolvedId FROM article WHERE deleted_at = 5000"))
            assertEquals(listOf("garden"), db.texts("SELECT tag FROM article_tags WHERE itemId = 'a1'"))
            val articleIndexes = db.texts("SELECT name FROM pragma_index_list('article')").toSet()
            assertTrue(
                articleIndexes.containsAll(
                    listOf(
                        "index_article_deleted_at_archived_at_timeAdded",
                        "index_article_deleted_at_archived_at_timeFavorited_timeAdded",
                        "index_article_timeUpdated_itemId",
                        "index_article_backed_up_at_deleted_at_timeAdded",
                        "index_article_resolvedId",
                        "index_article_normalized_url",
                    )
                )
            )
            assertTrue("index_article_tags_tag" in db.texts("SELECT name FROM pragma_index_list('article_tags')"))
        }
    }

    @Test
    fun migrate9To10_rebuildsSearchIndex() = runBlocking {
        helper.createDatabase(9).use { db ->
            db.insertArticle("article", "a1", "Growing roses")
            db.insertArticle("article", "a2", "Pruning apple trees")
            db.insertArticle("article", "a3", "Harbor lantern walk")
            db.execSQL("UPDATE article SET deleted_at = 5000 WHERE itemId = 'a2'")
        }

        helper.runMigrationsAndValidate(10, listOf(MIGRATION_9_10)).use { db ->
            assertEquals(listOf("a1", "a2", "a3"), db.texts("SELECT itemId FROM article ORDER BY itemId"))
            assertEquals(
                listOf("Growing roses", "Pruning apple trees", "Harbor lantern walk"),
                db.texts("SELECT title FROM article ORDER BY itemId"),
            )
            assertEquals(listOf("a2"), db.texts("SELECT itemId FROM article WHERE deleted_at = 5000"))
            // FTS5 keeps one docsize row per indexed article: the backfill indexed all three.
            assertEquals(3L, db.long("SELECT COUNT(*) FROM article_fts_docsize"))
            assertTrue(db.long("SELECT COUNT(*) FROM sqlite_master WHERE name = 'article_fts' AND sql LIKE '%fts5%'") == 1L)
            assertEquals(0L, db.long("SELECT COUNT(*) FROM sqlite_master WHERE name = 'article_fts_segments'"))
            assertEquals(listOf("a1"), db.searchTitle("roses"))
            assertEquals(listOf("a3"), db.searchTitle("lantern"))
            assertTrue("index_article_images_itemId" in db.texts("SELECT name FROM pragma_index_list('article_images')"))
            assertTrue("index_article_authors_itemId" in db.texts("SELECT name FROM pragma_index_list('article_authors')"))
        }
    }

    @Test
    fun migrate1To10_chain() = runBlocking {
        helper.createDatabase(1).use { db ->
            db.insertArticle("PocketArticle", "a1", "Growing roses", pocketId = "p1")
            db.insertArticle("PocketArticle", "a2", "Pruning apple trees")
            db.execSQL("INSERT INTO PocketTags (itemId, tag) VALUES ('a1', 'garden')")
        }

        helper.runMigrationsAndValidate(10, ALL_MIGRATIONS.toList()).use { db ->
            assertEquals(2L, db.long("SELECT COUNT(*) FROM article"))
            assertEquals(listOf("garden"), db.texts("SELECT tag FROM article_tags WHERE itemId = 'a1'"))
            assertEquals(listOf("p1"), db.texts("SELECT articleId FROM article WHERE itemId = 'a1'"))
            assertEquals(listOf("a1"), db.searchTitle("roses"))
            assertTrue(db.long("SELECT COUNT(*) FROM article WHERE backed_up_at IS NULL AND normalized_url IS NULL") == 2L)
            assertEquals(2L, db.long("SELECT COUNT(*) FROM article WHERE sync_failures = 0"))
            assertTrue("index_article_tags_tag" in db.texts("SELECT name FROM pragma_index_list('article_tags')"))
            assertEquals(2L, db.long("SELECT COUNT(*) FROM article_fts_docsize"))
        }
    }

    private fun SQLiteConnection.insertArticle(table: String, itemId: String, title: String, pocketId: String? = null) {
        val idColumn = if (table == "PocketArticle") ", pocketId" else ""
        val idValue = if (table == "PocketArticle") ", '${pocketId ?: "0"}'" else ""
        execSQL(
            "INSERT INTO $table (itemId, title, givenTitle, url, wordCount, status, hasImage, hasVideo, hasAudio, " +
                "sortId, timeAdded, timeUpdated, timeFavorited, listenDurationEstimate$idColumn) " +
                "VALUES ('$itemId', '$title', '$title', 'https://example.com/$itemId', 0, '0', 0, 0, 0, 0, 1, 1, 0, 0$idValue)"
        )
    }

    private fun SQLiteConnection.long(sql: String): Long = prepare(sql).use { it.step(); it.getLong(0) }

    private fun SQLiteConnection.texts(sql: String): List<String> = prepare(sql).use {
        buildList { while (it.step()) add(it.getText(0)) }
    }

    private fun SQLiteConnection.searchTitle(word: String): List<String> =
        texts("SELECT itemId FROM article WHERE rowid IN (SELECT rowid FROM article_fts WHERE article_fts MATCH '$word') ORDER BY itemId")
}
