package com.jayteealao.trails.network.mapper

import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.network.PocketArticleResponse
import com.jayteealao.trails.network.PocketData


fun PocketArticleResponse.toPocketArticleEntity() = PocketArticle(
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
    pocketId = this.itemId
    )

fun PocketArticleResponse.toPocketData() = PocketData(
    pocketArticle = this.toPocketArticleEntity(),
    pocketImages = this.images?.values?.toList() ?: emptyList(),
    pocketVideos = this.videos?.values?.toList() ?: emptyList(),
    pocketTags = this.tags?.values?.toList() ?: emptyList(),
    pocketAuthors = this.authors?.values?.toList() ?: emptyList(),
    domainMetadata = this.domainMetadata
)