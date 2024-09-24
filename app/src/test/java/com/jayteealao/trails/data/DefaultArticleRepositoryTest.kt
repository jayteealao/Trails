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

package com.jayteealao.trails.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * Unit tests for [DefaultArticleRepository].
 */
@OptIn(ExperimentalCoroutinesApi::class) // TODO: Remove when stable
class DefaultArticleRepositoryTest {

    @Test
    fun pockets_newItemSaved_itemIsReturned() = runTest {
//        val repository = DefaultArticleRepository(FakePocketDao())

//        repository.add("Repository")

//        assertEquals(repository.pockets.first().size, 1)
    }

}

//private class FakePocketDao : PocketDao {
//
//    private val data = mutableListOf<Pocket>()
//
//    override fun getArticles(): Flow<List<Pocket>> = flow {
//        emit(data)
//    }
//
//    override suspend fun insertPocket(item: Pocket) {
//        data.add(0, item)
//    }
//}
