package com.jayteealao.trails.network.article

import javax.inject.Inject

class ArticleClient @Inject constructor(
    private val articleService: ArticleService
) {
    suspend fun getRequestToken(consumerKey: String, redirectUri: String) =
        articleService.getRequestToken(consumerKey, redirectUri)

//    suspend fun authorize(requestToken: String, redirectUri: String) =
//        articleService.authorize(requestToken, redirectUri)

    suspend fun getAccessToken(consumerKey: String, requestToken: String) =
        articleService.getAccessToken(consumerKey, requestToken)

    suspend fun retrieve(params: Map<String, String>) =
        articleService.retrieve(params)
}