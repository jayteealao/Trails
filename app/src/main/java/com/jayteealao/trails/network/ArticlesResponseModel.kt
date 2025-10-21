package com.jayteealao.trails.network

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName
import com.jayteealao.trails.data.local.database.Article
import kotlinx.serialization.SerialName

data class ArticlesResponseModel(
    val status: Int,
    val complete: Int,
    val list: Map<String, ArticleResponse>,
    val error: String?,
    val since: Int
)

@Entity
data class ArticleResponse(
    @SerializedName("item_id") val itemId: String,
    @SerializedName("resolved_id") val resolvedId: String,
    @SerializedName("resolved_title") val title: String,
    @SerializedName("given_title") val givenTitle: String,
    @SerializedName("resolved_url") val url: String,
    @SerializedName("given_url") val givenUrl: String,
    @SerializedName("excerpt") val excerpt: String,
    @SerializedName("word_count") val wordCount: Int,
    @SerializedName("favorite") val favorite: String,
    @SerializedName("status") val status: String,
    @SerializedName("word_count_message") val wordCountMessage: String,
    @SerializedName("image") val image: ArticleImage?,
    @SerializedName("top_image_url") val topImageUrl: String,
    @SerializedName("images") val images: Map<String, ArticleImage> = emptyMap(),
    @SerializedName("has_image") val hasImage: Boolean,
    @SerializedName("videos") val videos: Map<String, ArticleVideo> = emptyMap(),
    @SerializedName("has_video") val hasVideo: Boolean,
    @SerializedName("has_audio") val hasAudio: Boolean,
    @SerializedName("tags") val tags: Map<String, ArticleTag> = emptyMap(),
    @SerializedName("authors") val authors: Map<String, ArticleAuthor> = emptyMap(),
    @SerializedName("list") val list: String,
    @SerializedName("sort_id") val sortId: Int,
    @SerializedName("time_added") val timeAdded: Long,
    @SerializedName("time_updated") val timeUpdated: Long,
    @SerializedName("time_read") val timeRead: Long,
    @SerializedName("time_favorited") val timeFavorited: Long,
    @SerializedName("time_to_read") val timeToRead: Int,
    @SerializedName("listen_duration_estimate") val listenDurationEstimate: Int,
    @SerializedName("domain_metadata") val domainMetadata: DomainMetadata,
)

@kotlinx.serialization.Serializable()
@Entity(tableName = "article_image", primaryKeys = ["imageId", "itemId"])
data class ArticleImage(
    @SerialName("image_id") val imageId: String,
    @SerialName("item_id") val itemId: String,
    @SerializedName("src") val src: String,
    @SerializedName("width") val width: Int,
    @SerializedName("height") val height: Int,
    @SerializedName("credit") val credit: String,
    @SerializedName("caption") val caption: String,
)

@kotlinx.serialization.Serializable()
@Entity(tableName = "article_video", primaryKeys = ["videoId", "itemId"])
data class ArticleVideo(
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

@kotlinx.serialization.Serializable()
@Entity(tableName = "article_tag", primaryKeys = ["itemId", "tag"])
data class ArticleTag(
    @SerialName("item_id") val itemId: String,
    @SerializedName("tag") val tag: String,
    @SerialName("sort_id") val sortId: Int?,
    @SerializedName("type") val type: String?,
)

@kotlinx.serialization.Serializable()
@Entity(tableName = "article_author")
data class ArticleAuthor(
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
    val images: List<ArticleImage>,
    val videos: List<ArticleVideo>,
    val tags: List<ArticleTag>,
    val authors: List<ArticleAuthor>,
    val domainMetadata: DomainMetadata?,
)
