package com.jayteealao.trails.usecases

import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.PocketRepository
import com.jayteealao.trails.data.local.database.PocketArticle
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import timber.log.Timber
import javax.inject.Inject

class GetArticleWithTextUseCase @Inject constructor(
    private val pocketRepository: PocketRepository
) {
    operator fun invoke() = pocketRepository.pockets()
}