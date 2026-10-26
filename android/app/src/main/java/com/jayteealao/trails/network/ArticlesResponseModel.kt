package com.jayteealao.trails.network

import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.PrimaryKey
import com.google.gson.annotations.SerializedName
import com.jayteealao.trails.data.local.database.Article
import kotlinx.serialization.SerialName

/** Indexed by itemId: the sync push and restore read an article's rows by itemId alone. */
@kotlinx.serialization.Serializable()
@Entity(tableName = "article_images", primaryKeys = ["imageId", "itemId"], indices = [Index(value = ["itemId"])])
data class ArticleImages(
    @SerialName("image_id") val imageId: String,
    @SerialName("item_id") val itemId: String,
    @SerializedName("src") val src: String,
    @SerializedName("width") val width: Int,
    @SerializedName("height") val height: Int,
    @SerializedName("credit") val credit: String,
    @SerializedName("caption") val caption: String,
)

/** Indexed by itemId: the sync push and restore read an article's rows by itemId alone. */
@kotlinx.serialization.Serializable()
@Entity(tableName = "article_videos", primaryKeys = ["videoId", "itemId"], indices = [Index(value = ["itemId"])])
data class ArticleVideos(
    @SerialName("video_id") val videoId: String,
    @SerialName("item_id") val itemId: String,
    @SerializedName("src") val src: String,
    @SerializedName("width") val width: Int,
    @SerializedName("height") val height: Int,
    @SerializedName("type") val type: String,
    @SerializedName("vid") val vid: String,
    @SerializedName("duration") val duration: Int? = 0,
    @SerializedName("image") val image: String?,
)

/** Indexed by tag for the tag view and the tag list; the primary key serves lookups by itemId. */
@kotlinx.serialization.Serializable()
@Entity(tableName = "article_tags", primaryKeys = ["itemId", "tag"], indices = [Index(value = ["tag"])])
data class ArticleTags(
    @SerialName("item_id") val itemId: String,
    @SerializedName("tag") val tag: String,
    @SerialName("sort_id") val sortId: Int?,
    @SerializedName("type") val type: String?,
)

/** Indexed by itemId: the sync push and restore read an article's rows by itemId alone. */
@kotlinx.serialization.Serializable()
@Entity(tableName = "article_authors", indices = [Index(value = ["itemId"])])
data class ArticleAuthors(
    @SerialName("author_id") @PrimaryKey  val authorId: String,
    @SerialName("item_id")val itemId: String,
    @SerializedName("name") val name: String,
    @SerializedName("url") val url: String,
    @SerializedName("domain") val domain: String?,
    @SerializedName("image") val image: String?,
    @SerializedName("bio") val bio: String?,
    @SerializedName("twitter") val twitter: String?,
)
@Entity
data class DomainMetadata(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    @SerializedName("name") val name: String?,
    @SerializedName("logo") val logo: String?,
    @SerializedName("domain") val domain: String?,
)

data class ArticleData(
    val article: Article,
    val images: List<ArticleImages>,
    val videos: List<ArticleVideos>,
    val tags: List<ArticleTags>,
    val authors: List<ArticleAuthors>,
    val domainMetadata: DomainMetadata?,
)
