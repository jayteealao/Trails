package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.PocketRepository
import kotlinx.coroutines.flow.first
import timber.log.Timber
import javax.inject.Inject

class SynchronizePocketUseCase @Inject constructor(
    private val pocketRepository: PocketRepository,
) {
    suspend operator fun invoke() = pocketRepository.synchronize()
}