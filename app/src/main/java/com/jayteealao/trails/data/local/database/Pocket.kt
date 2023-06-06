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

import androidx.compose.ui.geometry.Offset
import androidx.paging.PagingData
import androidx.paging.PagingSource
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Upsert
import com.jayteealao.trails.network.DomainMetadata
import com.jayteealao.trails.network.PocketAuthors
import com.jayteealao.trails.network.PocketImages
import com.jayteealao.trails.network.PocketTags
import com.jayteealao.trails.network.PocketVideos
import kotlinx.coroutines.flow.Flow
import java.net.URL

@Entity
data class PocketArticle(
    @PrimaryKey val itemId: String,
    val resolvedId: String?,
    val title: String,
    val givenTitle: String,
    val url: String?,
    val givenUrl: String?,
    val excerpt: String?,
    val wordCount: Int,
    val favorite: String?,
    val status: String,
    val wordCountMessage: String?,
    val image: String?,
    val hasImage: Boolean,
    val hasVideo: Boolean,
    val hasAudio: Boolean,
    val sortId: Int,
    val timeAdded: Long,
    val timeUpdated: Long,
    val timeRead: Long,
    val timeFavorited: Long,
    val timeToRead: Int,
    val listenDurationEstimate: Int,
    var text : String? = null,
)

//@Entity
//data class PocketImages(
//    @PrimaryKey val imageId: String,
//    val src: String,
//    val width: Int,
//    val height: Int,
//    val credit: String,
//    val caption: String,
//)
//
//@Entity
//data class PocketVideos(
//    @PrimaryKey val videoId: String,
//    val src: String,
//    val width: Int,
//    val height: Int,
//    val type: String,
//    val vid: String,
//    val duration: Int,
//    val image: String,
//)
//
//@Entity
//data class PocketTags(
//    @PrimaryKey val itemId: String,
//    val tag: String,
//    val sortId: Int,
//    val type: String,
//)
//
//@Entity
//data class PocketAuthors(
//    @PrimaryKey val itemId: String,
//    val authorId: String,
//    val name: String,
//    val url: String,
//    val domain: String,
//    val image: String,
//    val bio: String,
//    val twitter: String,
//)
//
//@Entity
//data class DomainMetadata(
//    @PrimaryKey val name: String,
//    val logo: String,
//    val domain: String,
//)

@Entity(tableName = "pocketarticle_fts")
@Fts4(contentEntity = PocketArticle::class)
data class PocketArticleFts(
    val itemId: String,
    val title: String,
    var text : String? = null,
)

@Dao
interface PocketDao {
    @Query("SELECT itemId, title, url FROM pocketarticle ORDER BY timeAdded DESC")
    fun getPockets(): PagingSource<Int, PocketTuple>

    @Query("SELECT * FROM pocketarticle WHERE itemId = :itemId")
    fun getPocketById(itemId: String): PocketArticle?

    @Upsert
    suspend fun insertPocket(item: PocketArticle)

    @Upsert
    suspend fun insertPockets(items: List<PocketArticle>)

    @Upsert
    suspend fun insertPocketImages(items: List<PocketImages>)

    @Upsert
    suspend fun insertPocketVideos(item: List<PocketVideos>)

    @Upsert
    suspend fun insertPocketTags(items: List<PocketTags>)

    @Upsert
    suspend fun insertPocketAuthors(items: List<PocketAuthors>)

    @Upsert
    suspend fun insertDomainMetadata(item: DomainMetadata)

    @Query("""
        SELECT pocketarticle.itemId, pocketarticle.title, pocketarticle.url FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
    """)
    suspend fun searchPockets(query: String): List<PocketTuple>

    @Query("""
        SELECT pocketarticle.itemId, pocketarticle.title, pocketarticle.url, snippet(pocketarticle_fts) as snippet, matchinfo(pocketarticle_fts) as matchInfo FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
    """)
    suspend fun searchPocketsWithMatchInfo(query: String): List<PocketWithMatchInfo>

    @Query("""
        SELECT * FROM pocketarticle
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLatestArticle(): PocketArticle?

    @Query("""
        SELECT * FROM pocketarticle
        WHERE text IS NULL
        ORDER BY timeAdded DESC
        LIMIT 10
        OFFSET :offset
    """
    )
    fun getPocketsWithoutText(offset: Int): List<PocketArticle>
}

data class PocketTuple(
    val itemId: String,
    val title: String,
    val url: String,
    val snippet: String? = null,
) {
    val domain: String by lazy {
        URL(url).host
    }
}

data class PocketWithMatchInfo(
    @Embedded val pocket: PocketTuple,
    @ColumnInfo(name = "matchInfo")
    val matchInfo: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as PocketWithMatchInfo

        if (pocket != other.pocket) return false
        if (!matchInfo.contentEquals(other.matchInfo)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = pocket.hashCode()
        result = 31 * result + matchInfo.contentHashCode()
        return result
    }
}
