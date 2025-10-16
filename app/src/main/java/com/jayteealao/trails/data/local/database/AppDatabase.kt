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
import com.jayteealao.trails.network.DomainMetadata
import com.jayteealao.trails.network.PocketAuthors
import com.jayteealao.trails.network.PocketImages
import com.jayteealao.trails.network.PocketTags
import com.jayteealao.trails.network.PocketVideos

@Database(
    entities = [
        PocketArticle::class,
        PocketArticleFts::class,
        PocketTags::class,
        PocketAuthors::class,
        PocketImages::class,
        PocketVideos::class,
        DomainMetadata::class,
//        ModalArticleTable::class,
//        PocketSummary::class,
    ],
    version = 3,
    autoMigrations = [],
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pocketDao(): PocketDao
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
