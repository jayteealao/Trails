package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.screens.articleList.ArticleSortOption
import javax.inject.Inject

class GetArticleWithTextUseCase @Inject constructor(
    private val pocketRepository: ArticleRepository
) {
    operator fun invoke(sortOption: ArticleSortOption = ArticleSortOption.Newest) = when (sortOption) {
        ArticleSortOption.Newest -> pocketRepository.pockets()
        ArticleSortOption.Oldest -> pocketRepository.pocketsOldest()
    }
}