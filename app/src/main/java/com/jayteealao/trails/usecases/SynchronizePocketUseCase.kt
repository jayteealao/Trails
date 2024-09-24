package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.ArticleRepository
import javax.inject.Inject

class SynchronizePocketUseCase @Inject constructor(
    private val pocketRepository: ArticleRepository,
) {
    suspend operator fun invoke() = pocketRepository.synchronize()
}