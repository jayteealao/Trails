package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.ArticleRepository
import javax.inject.Inject

class GetArticleWithTextUseCase @Inject constructor(
    private val articleRepository: ArticleRepository
) {
    operator fun invoke() = articleRepository.articles()
}