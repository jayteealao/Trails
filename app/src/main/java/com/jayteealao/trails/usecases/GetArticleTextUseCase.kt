package com.jayteealao.trails.usecases

import com.jayteealao.trails.network.ArticleExtractor
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.URL
import javax.inject.Inject

class GetArticleTextUseCase @Inject constructor(
    private val articleExtractor: ArticleExtractor
) {
    suspend operator fun invoke(url: String): String? {
        return articleExtractor.extractEssence(url.toHttpUrl())
    }
}