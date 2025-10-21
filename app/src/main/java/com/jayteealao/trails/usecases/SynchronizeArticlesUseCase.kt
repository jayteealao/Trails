package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.ArticleRepository
import javax.inject.Inject

class SynchronizeArticlesUseCase @Inject constructor(
    private val articleRepository: ArticleRepository,
) {
    suspend operator fun invoke() = articleRepository.synchronize()
}