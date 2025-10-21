package com.jayteealao.trails.usecases

import com.jayteealao.trails.network.article.ArticleClient
import javax.inject.Inject

class GetRequestTokenUseCase @Inject constructor(
    private val articleClient: ArticleClient
) {
    suspend operator fun invoke(consumerKey: String, redirectUri: String) =
        articleClient.getRequestToken(consumerKey, redirectUri)
}