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
import com.jayteealao.trails.network.ArticleAuthor
import com.jayteealao.trails.network.ArticleImage
import com.jayteealao.trails.network.ArticleTag
import com.jayteealao.trails.network.ArticleVideo
import com.jayteealao.trails.data.models.ArticleSummary
import com.jayteealao.trails.network.DomainMetadata

@Database(
    entities = [
        Article::class,
        ArticleFts::class,
        ArticleTag::class,
        ArticleAuthor::class,
        ArticleImage::class,
        ArticleVideo::class,
        DomainMetadata::class,
        ModalArticleTable::class,
        ArticleSummary::class,
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
            CREATE TABLE IF NOT EXISTS `article_tag` (
                `itemId` TEXT NOT NULL,
                `tag` TEXT NOT NULL,
                `sortId` INTEGER,
                `type` TEXT,
                PRIMARY KEY(`itemId`, `tag`)
            )
            """.trimIndent()
        )

        if (db.tableExists("pockettags")) {
            db.execSQL(
                """
                INSERT OR IGNORE INTO `article_tag` (`itemId`, `tag`, `sortId`, `type`)
                SELECT `itemId`, `tag`, `sortId`, `type` FROM `pockettags`
                """.trimIndent()
            )
            db.execSQL("DROP TABLE `pockettags`")
        }
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `Article` ADD COLUMN `deleted_at` INTEGER")
        db.execSQL("ALTER TABLE `Article` ADD COLUMN `archived_at` INTEGER")
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        if (db.tableExists("Article")) {
            db.execSQL("ALTER TABLE `Article` RENAME TO `article`")
        }
        if (db.tableExists("pocketarticle_fts")) {
            db.execSQL("ALTER TABLE `pocketarticle_fts` RENAME TO `article_fts`")
        }
        if (db.tableExists("pockettags")) {
            db.execSQL("ALTER TABLE `pockettags` RENAME TO `article_tag`")
        }
        if (db.tableExists("pocketauthors")) {
            db.execSQL("ALTER TABLE `pocketauthors` RENAME TO `article_author`")
        }
        if (db.tableExists("pocketimages")) {
            db.execSQL("ALTER TABLE `pocketimages` RENAME TO `article_image`")
        }
        if (db.tableExists("pocketvideos")) {
            db.execSQL("ALTER TABLE `pocketvideos` RENAME TO `article_video`")
        }
        if (db.tableExists("article") && db.columnExists("article", "pocketId")) {
            db.execSQL("ALTER TABLE `article` RENAME COLUMN `pocketId` TO `remote_id`")
        }
    }
}

private fun SupportSQLiteDatabase.tableExists(tableName: String): Boolean {
    query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        arrayOf(tableName)
    ).use { cursor ->
        return cursor.moveToFirst()
    }
}

private fun SupportSQLiteDatabase.columnExists(tableName: String, columnName: String): Boolean {
    query("PRAGMA table_info(`$tableName`)").use { cursor ->
        while (cursor.moveToNext()) {
            if (cursor.getString(1) == columnName) {
                return true
            }
        }
    }
    return false
}
