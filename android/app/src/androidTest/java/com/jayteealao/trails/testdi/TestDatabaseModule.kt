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

package com.jayteealao.trails.testdi

import android.content.Context
import androidx.room.Room
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.local.di.DatabaseModule
import dagger.Module
import dagger.Provides
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dagger.hilt.testing.TestInstallIn
import javax.inject.Singleton

/**
 * Hilt test module that swaps the production [DatabaseModule] for an in-memory
 * Room database in instrumented tests, so DB-backed tests run against a fresh,
 * isolated database with no on-disk state, migrations, or backfill callback.
 *
 * The production [com.jayteealao.trails.data.di.DataModule] binding of
 * `ArticleRepositoryImpl` → `ArticleRepository` is left untouched: the repository
 * is exercised against this in-memory database. Provider signatures mirror
 * [DatabaseModule] exactly so this is a drop-in replacement for the Hilt graph.
 */
@Module
@TestInstallIn(
    components = [SingletonComponent::class],
    replaces = [DatabaseModule::class]
)
class TestDatabaseModule {

    @Provides
    @Singleton
    fun provideInMemoryDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @Provides
    fun provideArticleDao(appDatabase: AppDatabase): ArticleDao = appDatabase.articleDao()

    @Provides
    fun provideLocalArchiveDao(appDatabase: AppDatabase): LocalArchiveDao =
        appDatabase.localArchiveDao()
}
