package com.jayteealao.trails.network.mapper

import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.ArticleResponse


fun ArticleResponse.toArticleEntity() = Article(
    itemId = generateId(),
    title = this.title ?: "",
    excerpt = this.excerpt ?: "",
    url = this.url ?: "",
    image = this.topImageUrl,
    timeAdded = this.timeAdded,
    timeRead = this.timeRead,
    timeUpdated = this.timeUpdated,
    favorite = this.favorite,
    status = this.status,
    wordCount = this.wordCount,
    sortId = this.sortId,
    resolvedId = this.resolvedId ?: "",
    givenUrl = this.givenUrl ?: "",
    givenTitle = this.givenTitle ?: "",
    timeToRead = this.timeToRead,
    hasVideo = this.hasVideo,
    hasImage = this.hasImage,
    wordCountMessage = this.wordCountMessage,
    timeFavorited = this.timeFavorited,
    hasAudio = this.hasAudio,
    listenDurationEstimate = this.listenDurationEstimate,
    remoteId = this.itemId
    )

fun ArticleResponse.toArticleData() = ArticleData(
    article = this.toArticleEntity(),
    images = this.images?.values?.toList() ?: emptyList(),
    videos = this.videos?.values?.toList() ?: emptyList(),
    tags = this.tags?.values?.toList() ?: emptyList(),
    authors = this.authors?.values?.toList() ?: emptyList(),
    domainMetadata = this.domainMetadata
)