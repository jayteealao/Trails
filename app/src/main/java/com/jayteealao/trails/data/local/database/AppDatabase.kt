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

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
//        ModalArticleTable::class,
//        PocketSummary::class,
    ],
    version = 4,
    autoMigrations = [],
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun articleDao(): ArticleDao
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
