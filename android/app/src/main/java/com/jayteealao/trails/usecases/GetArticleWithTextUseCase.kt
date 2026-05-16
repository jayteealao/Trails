package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.ArticleRepository
import javax.inject.Inject

class GetArticleWithTextUseCase @Inject constructor(
    private val pocketRepository: ArticleRepository
) {
    operator fun invoke() = pocketRepository.pockets()
}