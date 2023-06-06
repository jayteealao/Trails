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

package com.jayteealao.trails.data.local.di

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.PocketDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton


@Module
@InstallIn(SingletonComponent::class)
class DatabaseModule {
    @Provides
    fun providePocketDao(appDatabase: AppDatabase): PocketDao {
        return appDatabase.pocketDao()
    }

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext appContext: Context): AppDatabase {
        return Room.databaseBuilder(
            appContext,
            AppDatabase::class.java,
            "Pocket"
        )
            .addMigrations(MIGRATION_1_2)
//            .addCallback(
//            object : RoomDatabase.Callback() {
//                override fun onOpen(db: SupportSQLiteDatabase) {
//                    super.onOpen(db)
//                    db.execSQL("INSERT INTO pocketarticle_fts(pocketarticle_fts) VALUES ('rebuild')")
//                }
//            }
//        )
            .fallbackToDestructiveMigration()
            .build()
    }
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("DROP TABLE `pocketarticle_fts`")
        database.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS `pocketarticle_fts` USING FTS4(`itemId` TEXT NOT NULL, `title` TEXT NOT NULL, `text` TEXT, content=`PocketArticle`)")
        database.execSQL("INSERT INTO `pocketarticle_fts` (`itemId`,`title`,`text`,`docid`) SELECT `itemId`,`title`,`text`,`rowid` FROM `PocketArticle`")
    }
}
