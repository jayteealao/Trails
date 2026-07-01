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
import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
        ArticleTags::class,
        ArticleAuthors::class,
        ArticleImages::class,
        ArticleVideos::class,
        DomainMetadata::class,
        LocalArchive::class,
    ],
    version = 7,
    autoMigrations = [],
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun articleDao(): ArticleDao
    abstract fun localArchiveDao(): LocalArchiveDao
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
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

        db.execSQL(
            """
            INSERT OR IGNORE INTO `pockettags_new` (`itemId`, `tag`, `sortId`, `type`)
            SELECT `itemId`, `tag`, `sortId`, `type` FROM `pockettags`
            """.trimIndent()
        )

        db.execSQL("DROP TABLE `pockettags`")
        db.execSQL("ALTER TABLE `pockettags_new` RENAME TO `pockettags`")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `PocketArticle` ADD COLUMN `deleted_at` INTEGER")
        db.execSQL("ALTER TABLE `PocketArticle` ADD COLUMN `archived_at` INTEGER")
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // Step 1: Rename PocketArticle to article_old (temporary name)
        db.execSQL("ALTER TABLE `PocketArticle` RENAME TO `article_old`")

        // Step 2: Create new article table with correct schema (pocketId -> articleId)
        db.execSQL("""
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
        db.execSQL("""
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
        db.execSQL("DROP TABLE `article_old`")

        // Step 5: Recreate FTS table with correct content reference
        // First drop the old FTS table
        db.execSQL("DROP TABLE IF EXISTS `pocketarticle_fts`")

        // Create new FTS table pointing to the new article table
        db.execSQL("""
            CREATE VIRTUAL TABLE IF NOT EXISTS `article_fts`
            USING FTS4(
                `itemId` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `text` TEXT,
                content=`article`
            )
        """.trimIndent())

        // Rebuild FTS index from the article table
        db.execSQL("INSERT INTO `article_fts`(`article_fts`) VALUES ('rebuild')")

        // Step 6: Rename tags table
        db.execSQL("ALTER TABLE `pockettags` RENAME TO `article_tags`")

        // Step 7: Rename images table
        db.execSQL("ALTER TABLE `PocketImages` RENAME TO `article_images`")

        // Step 8: Rename videos table
        db.execSQL("ALTER TABLE `PocketVideos` RENAME TO `article_videos`")

        // Step 9: Rename authors table
        db.execSQL("ALTER TABLE `PocketAuthors` RENAME TO `article_authors`")
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `article` ADD COLUMN `text_source` TEXT NOT NULL DEFAULT ''")
        db.execSQL("""
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
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `article` ADD COLUMN `normalized_url` TEXT DEFAULT NULL")
    }
}

val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // Add backed_up_at column. Existing rows get NULL (never backed up);
        // the reconciliation sweep will back them up on next sync.
        // Non-destructive: no data is deleted or altered.
        db.execSQL("ALTER TABLE `article` ADD COLUMN `backed_up_at` INTEGER DEFAULT NULL")
    }
}

/**
 * Backfills the `normalized_url` column for existing articles after migration 5→6.
 * Uses SharedPreferences flag to ensure it runs only once.
 */
class UrlNormalizationCallback(private val context: Context) : RoomDatabase.Callback() {
    override fun onOpen(db: SupportSQLiteDatabase) {
        super.onOpen(db)
        val prefs = context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE)
        if (prefs.getBoolean("url_normalization_v1", false)) return

        val cursor = db.query("SELECT itemId, url, givenUrl FROM article WHERE normalized_url IS NULL")
        val updates = mutableListOf<Pair<String, String>>()
        cursor.use {
            while (it.moveToNext()) {
                val itemId = it.getString(0)
                val url = if (it.isNull(1)) null else it.getString(1)
                val givenUrl = if (it.isNull(2)) null else it.getString(2)
                val raw = url ?: givenUrl ?: continue
                updates.add(itemId to normalizeUrl(raw))
            }
        }

        if (updates.isNotEmpty()) {
            db.beginTransaction()
            try {
                val stmt = db.compileStatement("UPDATE article SET normalized_url = ? WHERE itemId = ?")
                for ((itemId, normalized) in updates) {
                    stmt.bindString(1, normalized)
                    stmt.bindString(2, itemId)
                    stmt.executeUpdateDelete()
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
            Timber.d("URL normalization backfill: updated ${updates.size} articles")
        }

        prefs.edit().putBoolean("url_normalization_v1", true).apply()
    }
}
