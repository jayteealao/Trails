/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.jayteealao.trails.data.local.database

import android.content.Context
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import com.jayteealao.trails.common.normalizeUrl
import timber.log.Timber
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.network.DomainMetadata

@Database(
    entities = [
        Article::class,
        ArticleFts::class,
        SyncState::class,
        ArticleTags::class,
        ArticleAuthors::class,
        ArticleImages::class,
        ArticleVideos::class,
        DomainMetadata::class,
        LocalArchive::class,
    ],
    version = 11,
    autoMigrations = [],
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun articleDao(): ArticleDao
    abstract fun localArchiveDao(): LocalArchiveDao
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override suspend fun migrate(connection: SQLiteConnection) {
        connection.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `pockettags_new` (
                `itemId` TEXT NOT NULL,
                `tag` TEXT NOT NULL,
                `sortId` INTEGER,
                `type` TEXT,
                PRIMARY KEY(`itemId`, `tag`)
            )
            """.trimIndent()
        )

        connection.execSQL(
            """
            INSERT OR IGNORE INTO `pockettags_new` (`itemId`, `tag`, `sortId`, `type`)
            SELECT `itemId`, `tag`, `sortId`, `type` FROM `pockettags`
            """.trimIndent()
        )

        connection.execSQL("DROP TABLE `pockettags`")
        connection.execSQL("ALTER TABLE `pockettags_new` RENAME TO `pockettags`")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override suspend fun migrate(connection: SQLiteConnection) {
        connection.execSQL("ALTER TABLE `PocketArticle` ADD COLUMN `deleted_at` INTEGER")
        connection.execSQL("ALTER TABLE `PocketArticle` ADD COLUMN `archived_at` INTEGER")
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Step 1: Rename PocketArticle to article_old (temporary name)
        connection.execSQL("ALTER TABLE `PocketArticle` RENAME TO `article_old`")

        // Step 2: Create new article table with correct schema (pocketId -> articleId)
        connection.execSQL("""
            CREATE TABLE IF NOT EXISTS `article` (
                `itemId` TEXT NOT NULL PRIMARY KEY,
                `resolvedId` TEXT,
                `title` TEXT NOT NULL,
                `givenTitle` TEXT NOT NULL,
                `url` TEXT,
                `givenUrl` TEXT,
                `excerpt` TEXT,
                `wordCount` INTEGER NOT NULL,
                `favorite` TEXT,
                `status` TEXT NOT NULL,
                `wordCountMessage` TEXT,
                `image` TEXT,
                `hasImage` INTEGER NOT NULL,
                `hasVideo` INTEGER NOT NULL,
                `hasAudio` INTEGER NOT NULL,
                `sortId` INTEGER NOT NULL,
                `timeAdded` INTEGER NOT NULL,
                `timeUpdated` INTEGER NOT NULL,
                `timeRead` INTEGER,
                `timeFavorited` INTEGER NOT NULL,
                `timeToRead` INTEGER,
                `listenDurationEstimate` INTEGER NOT NULL,
                `text` TEXT,
                `articleId` TEXT NOT NULL DEFAULT '0',
                `resolved` INTEGER NOT NULL DEFAULT 0,
                `deleted_at` INTEGER,
                `archived_at` INTEGER
            )
        """.trimIndent())

        // Step 3: Copy data from article_old to article, mapping pocketId to articleId
        connection.execSQL("""
            INSERT INTO `article` (
                `itemId`, `resolvedId`, `title`, `givenTitle`, `url`, `givenUrl`,
                `excerpt`, `wordCount`, `favorite`, `status`, `wordCountMessage`,
                `image`, `hasImage`, `hasVideo`, `hasAudio`, `sortId`,
                `timeAdded`, `timeUpdated`, `timeRead`, `timeFavorited`,
                `timeToRead`, `listenDurationEstimate`, `text`, `articleId`,
                `resolved`, `deleted_at`, `archived_at`
            )
            SELECT
                `itemId`, `resolvedId`, `title`, `givenTitle`, `url`, `givenUrl`,
                `excerpt`, `wordCount`, `favorite`, `status`, `wordCountMessage`,
                `image`, `hasImage`, `hasVideo`, `hasAudio`, `sortId`,
                `timeAdded`, `timeUpdated`, `timeRead`, `timeFavorited`,
                `timeToRead`, `listenDurationEstimate`, `text`, `pocketId`,
                `resolved`, `deleted_at`, `archived_at`
            FROM `article_old`
        """.trimIndent())

        // Step 4: Drop the old table
        connection.execSQL("DROP TABLE `article_old`")

        // Step 5: Recreate FTS table with correct content reference
        // First drop the old FTS table
        connection.execSQL("DROP TABLE IF EXISTS `pocketarticle_fts`")

        // Create new FTS table pointing to the new article table
        connection.execSQL("""
            CREATE VIRTUAL TABLE IF NOT EXISTS `article_fts`
            USING FTS4(
                `itemId` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `text` TEXT,
                content=`article`
            )
        """.trimIndent())

        // Rebuild FTS index from the article table
        connection.execSQL("INSERT INTO `article_fts`(`article_fts`) VALUES ('rebuild')")

        // Step 6: Rename tags table
        connection.execSQL("ALTER TABLE `pockettags` RENAME TO `article_tags`")

        // Step 7: Rename images table
        connection.execSQL("ALTER TABLE `PocketImages` RENAME TO `article_images`")

        // Step 8: Rename videos table
        connection.execSQL("ALTER TABLE `PocketVideos` RENAME TO `article_videos`")

        // Step 9: Rename authors table
        connection.execSQL("ALTER TABLE `PocketAuthors` RENAME TO `article_authors`")
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override suspend fun migrate(connection: SQLiteConnection) {
        connection.execSQL("ALTER TABLE `article` ADD COLUMN `text_source` TEXT NOT NULL DEFAULT ''")
        connection.execSQL("""
            CREATE TABLE IF NOT EXISTS `local_archive` (
                `itemId` TEXT NOT NULL,
                `archiveKey` TEXT NOT NULL,
                `localPath` TEXT NOT NULL,
                `compressedSizeBytes` INTEGER NOT NULL,
                `originalSizeBytes` INTEGER NOT NULL,
                `downloadedAt` INTEGER NOT NULL,
                `status` TEXT NOT NULL DEFAULT 'complete',
                PRIMARY KEY(`itemId`, `archiveKey`)
            )
        """.trimIndent())
    }
}

val MIGRATION_5_6 = object : Migration(5, 6) {
    override suspend fun migrate(connection: SQLiteConnection) {
        connection.execSQL("ALTER TABLE `article` ADD COLUMN `normalized_url` TEXT DEFAULT NULL")
    }
}

val MIGRATION_6_7 = object : Migration(6, 7) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Add backed_up_at column. Existing rows get NULL (never backed up);
        // the reconciliation sweep will back them up on next sync.
        // Non-destructive: no data is deleted or altered.
        connection.execSQL("ALTER TABLE `article` ADD COLUMN `backed_up_at` INTEGER DEFAULT NULL")
    }
}

val MIGRATION_7_8 = object : Migration(7, 8) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Add the failed-push counter. Every existing row starts at 0.
        // Non-destructive: no data is deleted or altered.
        connection.execSQL("ALTER TABLE `article` ADD COLUMN `sync_failures` INTEGER NOT NULL DEFAULT 0")
    }
}

val MIGRATION_8_9 = object : Migration(8, 9) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Adds indexes only; no row changes. Each statement is the createSql Room
        // exports for version 9, so the migrated tables match the declared indexes.
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_deleted_at_archived_at_timeAdded` ON `article` (`deleted_at`, `archived_at`, `timeAdded`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_deleted_at_archived_at_timeFavorited_timeAdded` ON `article` (`deleted_at`, `archived_at`, `timeFavorited`, `timeAdded`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_timeUpdated_itemId` ON `article` (`timeUpdated`, `itemId`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_backed_up_at_deleted_at_timeAdded` ON `article` (`backed_up_at`, `deleted_at`, `timeAdded`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_resolvedId` ON `article` (`resolvedId`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_normalized_url` ON `article` (`normalized_url`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_tags_tag` ON `article_tags` (`tag`)")
    }
}

val MIGRATION_9_10 = object : Migration(9, 10) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Replaces the FTS4 search index with FTS5 and rebuilds it from article, and indexes
        // the image, author and video rows by itemId; no row changes. Dropping the FTS4 table also drops its shadow tables. The table and
        // trigger statements are the ones Room exports for version 10.
        for (op in listOf("BEFORE_UPDATE", "BEFORE_DELETE", "AFTER_UPDATE", "AFTER_INSERT")) {
            connection.execSQL("DROP TRIGGER IF EXISTS room_fts_content_sync_article_fts_$op")
        }
        connection.execSQL("DROP TABLE IF EXISTS `article_fts`")
        connection.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS `article_fts` USING FTS5(`title`, `text`, tokenize=`porter unicode61 remove_diacritics 2`, content=`article`)")
        connection.execSQL("CREATE TRIGGER IF NOT EXISTS room_fts_content_sync_article_fts_BEFORE_UPDATE BEFORE UPDATE ON `article` BEGIN DELETE FROM `article_fts` WHERE `rowid`=OLD.`rowid`; END")
        connection.execSQL("CREATE TRIGGER IF NOT EXISTS room_fts_content_sync_article_fts_BEFORE_DELETE BEFORE DELETE ON `article` BEGIN DELETE FROM `article_fts` WHERE `rowid`=OLD.`rowid`; END")
        connection.execSQL("CREATE TRIGGER IF NOT EXISTS room_fts_content_sync_article_fts_AFTER_UPDATE AFTER UPDATE ON `article` BEGIN INSERT INTO `article_fts`(`rowid`, `title`, `text`) VALUES (NEW.`rowid`, NEW.`title`, NEW.`text`); END")
        connection.execSQL("CREATE TRIGGER IF NOT EXISTS room_fts_content_sync_article_fts_AFTER_INSERT AFTER INSERT ON `article` BEGIN INSERT INTO `article_fts`(`rowid`, `title`, `text`) VALUES (NEW.`rowid`, NEW.`title`, NEW.`text`); END")
        // Backfill: index every existing article.
        connection.execSQL("INSERT INTO `article_fts`(`article_fts`) VALUES ('rebuild')")
        // The sync push and restore read image and author rows by itemId.
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_images_itemId` ON `article_images` (`itemId`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_authors_itemId` ON `article_authors` (`itemId`)")
        connection.execSQL("CREATE INDEX IF NOT EXISTS `index_article_videos_itemId` ON `article_videos` (`itemId`)")
    }
}

val MIGRATION_10_11 = object : Migration(10, 11) {
    override suspend fun migrate(connection: SQLiteConnection) {
        // Moves the sync stamp and the failed-push counter to sync_state, so sync bookkeeping
        // stops rewriting the search index. Rows without a stamp or a strike get no sync_state
        // row (a missing row reads as never backed up, 0 strikes). DROP COLUMN keeps each
        // rowid, so the search index stays valid. The CREATE TABLE is the one Room exports
        // for version 11.
        connection.execSQL("CREATE TABLE IF NOT EXISTS `sync_state` (`itemId` TEXT NOT NULL, `backed_up_at` INTEGER DEFAULT NULL, `sync_failures` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(`itemId`))")
        connection.execSQL(
            "INSERT INTO `sync_state` (`itemId`, `backed_up_at`, `sync_failures`) " +
                "SELECT `itemId`, `backed_up_at`, `sync_failures` FROM `article` " +
                "WHERE `backed_up_at` IS NOT NULL OR `sync_failures` > 0"
        )
        // SQLite refuses to drop an indexed column, so the index goes first.
        connection.execSQL("DROP INDEX IF EXISTS `index_article_backed_up_at_deleted_at_timeAdded`")
        connection.execSQL("ALTER TABLE `article` DROP COLUMN `backed_up_at`")
        connection.execSQL("ALTER TABLE `article` DROP COLUMN `sync_failures`")
    }
}

/** Every hand-written migration, in order. Production and the tests register this one list. */
val ALL_MIGRATIONS: Array<Migration> = arrayOf(
    MIGRATION_1_2,
    MIGRATION_2_3,
    MIGRATION_3_4,
    MIGRATION_4_5,
    MIGRATION_5_6,
    MIGRATION_6_7,
    MIGRATION_7_8,
    MIGRATION_8_9,
    MIGRATION_9_10,
    MIGRATION_10_11,
)

/**
 * The one place that sets the SQLite engine, the migrations and the open callbacks (the URL
 * backfill and the search index check).
 * The app's database module and the tests build through it, so a test fails when
 * production stops registering any of them.
 */
fun RoomDatabase.Builder<AppDatabase>.configureAppDatabase(context: Context): RoomDatabase.Builder<AppDatabase> =
    setDriver(BundledSQLiteDriver())
        .addMigrations(*ALL_MIGRATIONS)
        .addCallback(UrlNormalizationCallback(context))
        .addCallback(FtsIndexCheckCallback())

/**
 * Recomputes the `normalized_url` column for every article with the current [normalizeUrl],
 * once per install. It first ran as a NULL-only backfill after migration 5→6 (marker
 * [URL_NORMALIZATION_V1]). The normalizer later started keeping route fragments (`#/`, `#!`),
 * so keys stored under the old rule are stale; [URL_NORMALIZATION_V2] makes every install,
 * including those that already have the v1 marker, recompute all rows once more.
 * The column is not unique, so rewriting keys cannot collide.
 */
class UrlNormalizationCallback(private val context: Context) : RoomDatabase.Callback() {
    override suspend fun onOpen(connection: SQLiteConnection) {
        super.onOpen(connection)
        val prefs = context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE)
        if (prefs.getBoolean(URL_NORMALIZATION_V2, false)) return

        val updates = mutableListOf<Pair<String, String>>()
        connection.prepare("SELECT itemId, url, givenUrl, normalized_url FROM article").use {
            while (it.step()) {
                val itemId = it.getText(0)
                val url = if (it.isNull(1)) null else it.getText(1)
                val givenUrl = if (it.isNull(2)) null else it.getText(2)
                val stored = if (it.isNull(3)) null else it.getText(3)
                val raw = url ?: givenUrl ?: continue
                val normalized = normalizeUrl(raw)
                if (normalized != stored) updates.add(itemId to normalized)
            }
        }

        if (updates.isNotEmpty()) {
            connection.execSQL("BEGIN IMMEDIATE TRANSACTION")
            try {
                connection.prepare("UPDATE article SET normalized_url = ? WHERE itemId = ?").use { stmt ->
                    for ((itemId, normalized) in updates) {
                        stmt.bindText(1, normalized)
                        stmt.bindText(2, itemId)
                        stmt.step()
                        stmt.reset()
                    }
                }
                connection.execSQL("END TRANSACTION")
            } catch (e: Throwable) {
                connection.execSQL("ROLLBACK TRANSACTION")
                throw e
            }
            Timber.d("URL normalization backfill: updated ${updates.size} articles")
        }

        prefs.edit()
            .putBoolean(URL_NORMALIZATION_V1, true)
            .putBoolean(URL_NORMALIZATION_V2, true)
            .apply()
    }

    companion object {
        /** Set after the first (NULL-only) backfill. Kept so older readers still see it. */
        const val URL_NORMALIZATION_V1 = "url_normalization_v1"

        /** Set after the full recompute that follows the route-fragment normalizer change. */
        const val URL_NORMALIZATION_V2 = "url_normalization_v2"
    }
}
