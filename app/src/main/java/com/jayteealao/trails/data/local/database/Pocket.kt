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

import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.Index
import androidx.room.PrimaryKey
import com.jayteealao.trails.data.models.ArticleItem
import kotlinx.serialization.Serializable

@Serializable
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
    val timeToRead: Int? = 0,
    val listenDurationEstimate: Int,
    var text : String? = null,
    @ColumnInfo(defaultValue = "0") val pocketId: String = "0",
    @ColumnInfo(defaultValue = "0") val resolved: Boolean = false,
)

@Entity(tableName = "pocketarticle_fts")
@Fts4(contentEntity = PocketArticle::class)
data class PocketArticleFts(
    val itemId: String,
    val title: String,
    var text : String? = null,
)

data class PocketWithMatchInfo(
    @Embedded val pocket: ArticleItem,
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

@Entity(
    indices = [Index(value = ["modalId"], unique = true)]
)
data class ModalArticleTable(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val pocketId: String,
    val modalId: String
)
