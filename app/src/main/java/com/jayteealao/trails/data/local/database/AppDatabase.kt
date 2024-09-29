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

import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.DeleteTable
import androidx.room.RoomDatabase
import androidx.room.migration.AutoMigrationSpec
import com.jayteealao.trails.data.models.PocketSummary
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
        ModalArticleTable::class,
        PocketSummary::class,
    ],
    version = 3,
    autoMigrations = [
        AutoMigration(from = 1, to = 2, spec = AutoMigrationSpec_1_2::class),
        AutoMigration(from = 2, to = 3),
//        AutoMigration(from = 3, to = 4),
//        AutoMigration(from = 4, to = 5),
//        AutoMigration(from = 5, to = 6),
//        AutoMigration(from = 5, to = 6, spec = AppDatabase.ModalDeleteTableSpec::class),
//        AutoMigration(from = 6, to = 7),
//        AutoMigration(from = 7, to = 8)
    ],
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pocketDao(): PocketDao
}

@DeleteTable(
    tableName = "ModalArticleTable")
class AutoMigrationSpec_1_2 : AutoMigrationSpec

