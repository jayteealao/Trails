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

package com.jayteealao.trails.data.di

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.ArticleRepositoryImpl
import com.jayteealao.trails.data.DefaultLibraryStatus
import com.jayteealao.trails.data.LibraryStatus
import com.jayteealao.trails.data.archive.ArchiveDownloads
import com.jayteealao.trails.data.archive.ArchiveRetryClient
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.FirebaseArchiveRetryClient
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
interface DataModule {

    @Singleton
    @Binds
    fun bindsArticleRepository(
        articleRepository: ArticleRepositoryImpl
    ): ArticleRepository

    @Singleton
    @Binds
    fun bindsArchiveRetryClient(
        archiveRetryClient: FirebaseArchiveRetryClient
    ): ArchiveRetryClient

    @Binds
    fun bindsArchiveDownloads(
        archiveService: ArchiveService
    ): ArchiveDownloads

    @Singleton
    @Binds
    fun bindsLibraryStatus(
        libraryStatus: DefaultLibraryStatus
    ): LibraryStatus
}
