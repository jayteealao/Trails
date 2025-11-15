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
@Entity(tableName = "article")
data class Article(
    @PrimaryKey val itemId: String = "",
    val resolvedId: String? = null,
    val title: String = "",
    val givenTitle: String = "",
    val url: String? = null,
    val givenUrl: String? = null,
    val excerpt: String? = null,
    val wordCount: Int = 0,
    val favorite: String? = null,
    val status: String = "",
    val wordCountMessage: String? = null,
    val image: String? = null,
    val hasImage: Boolean = false,
    val hasVideo: Boolean = false,
    val hasAudio: Boolean = false,
    val sortId: Int = 0,
    val timeAdded: Long = 0,
    val timeUpdated: Long = 0,
    val timeRead: Long? = null,
    val timeFavorited: Long = 0,
    val timeToRead: Int? = 0,
    val listenDurationEstimate: Int = 0,
    var text : String? = null,
    @ColumnInfo(defaultValue = "0") val articleId: String = "0",
    @ColumnInfo(defaultValue = "0") val resolved: Int = 0, // 0 = notResolved, 1 = synced, 2 = textadded, 3 = metrics, 10 = resolved
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "archived_at") val archivedAt: Long? = null,
)

@Entity(tableName = "article_fts")
@Fts4(contentEntity = Article::class)
data class ArticleFts(
    val itemId: String,
    val title: String,
    var text : String? = null,
)

data class ArticleWithMatchInfo(
    @Embedded val article: ArticleItem,
    @ColumnInfo(name = "matchInfo")
    val matchInfo: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as ArticleWithMatchInfo

        if (article != other.article) return false
        if (!matchInfo.contentEquals(other.matchInfo)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = article.hashCode()
        result = 31 * result + matchInfo.contentHashCode()
        return result
    }
}

@Entity(
    indices = [Index(value = ["modalId"], unique = true)]
)
data class ModalArticleTable(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val articleId: String,
    val modalId: String
)
