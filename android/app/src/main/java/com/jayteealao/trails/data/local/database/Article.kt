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

import androidx.room3.ColumnInfo
import androidx.room3.Entity
import androidx.room3.Fts5
import androidx.room3.FtsOptions
import androidx.room3.Index
import androidx.room3.PrimaryKey
import kotlinx.serialization.Serializable

/**
 * Indexes, each for named queries (equality columns first, the ORDER BY column last):
 * - deleted_at, archived_at, timeAdded: the library list and the archive list.
 * - deleted_at, archived_at, timeFavorited, timeAdded: the favourite list (live and not
 *   archived first, so the planner seeks and reads in favourite order without a sort).
 * - timeUpdated, itemId: the sync push pages and their count (keyset order).
 * - backed_up_at, deleted_at, timeAdded: the never-backed-up sweep and its count.
 * - resolvedId: the tag view and tag list matched by resolved id, getArticleByResolvedId.
 * - normalized_url: getArticleByNormalizedUrl (the save dedup). Not unique: existing
 *   libraries may hold duplicates.
 */
@Serializable
@Entity(
    tableName = "article",
    indices = [
        Index(value = ["deleted_at", "archived_at", "timeAdded"]),
        Index(value = ["deleted_at", "archived_at", "timeFavorited", "timeAdded"]),
        Index(value = ["timeUpdated", "itemId"]),
        Index(value = ["backed_up_at", "deleted_at", "timeAdded"]),
        Index(value = ["resolvedId"]),
        Index(value = ["normalized_url"]),
    ],
)
data class Article(
    @PrimaryKey val itemId: String = "",
    val resolvedId: String? = null,
    val title: String = "",
    val givenTitle: String = "",
    val url: String? = null,
    val givenUrl: String? = null,
    @ColumnInfo(name = "normalized_url") val normalizedUrl: String? = null,
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
    @ColumnInfo(name = "text_source", defaultValue = "") val textSource: String = "",
    /** Epoch-millis when this article was successfully backed up to Firestore (null = never). */
    @ColumnInfo(name = "backed_up_at", defaultValue = "NULL") val backedUpAt: Long? = null,
    /**
     * Failed push runs for this row; at MAX_SYNC_FAILURES the sync skips it.
     * Device-local: never backed up, 0 on restore.
     */
    @ColumnInfo(name = "sync_failures", defaultValue = "0") val syncFailures: Int = 0,
)

/**
 * The search index: an external-content FTS5 table over [Article]'s title and text. Room
 * keeps it in step with `article` through content-sync triggers keyed on `article`'s rowid.
 * Porter stemming over unicode61 with diacritics removed, so "running" finds "run" and
 * "cafe" finds "Café".
 */
@Entity(tableName = "article_fts")
@Fts5(
    contentEntity = Article::class,
    tokenizer = FtsOptions.TOKENIZER_PORTER,
    tokenizerArgs = ["unicode61", "remove_diacritics", "2"],
)
data class ArticleFts(
    val title: String,
    val text: String?,
)

@Entity(
    indices = [Index(value = ["modalId"], unique = true)]
)
data class ModalArticleTable(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val articleId: String,
    val modalId: String
)
