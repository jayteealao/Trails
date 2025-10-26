package com.jayteealao.trails.usecases

import com.jayteealao.trails.common.CONSUMERKEY
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.network.mapper.toPocketArticleEntity
import com.jayteealao.trails.network.pocket.PocketClient
import com.skydoves.sandwich.message
import com.skydoves.sandwich.onError
import com.skydoves.sandwich.onException
import com.skydoves.sandwich.onFailure
import com.skydoves.sandwich.onSuccess
import com.skydoves.sandwich.retrofit.errorBody
import kotlinx.coroutines.flow.first
import timber.log.Timber
import javax.inject.Inject

class GetArticlesFromNetworkUseCase @Inject constructor(
    private val pocketClient: PocketClient,
    private val getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase,
) {


    suspend operator fun invoke(count: Int = 10, offset: Int = 0): List<PocketArticle> {

        var result = emptyList<PocketArticle>()
        pocketClient.retrieve(
            mapOf(
                "consumer_key" to CONSUMERKEY,
                "access_token" to getAccessTokenFromLocalUseCase().first()!!,
                "count" to count.toString(),
                "offset" to offset.toString(),
                "detailType" to "complete"
            )
        ).onSuccess {
//            Timber.d("Success $data")
            result = data.list.values.toList().map { it.toPocketArticleEntity()}
        }.onError {
            Timber.d("Error $errorBody")
        }.onFailure {
            Timber.d("Failure ${this.message()}")
        }.onException {
            Timber.d("Exception ${this.message()}")
        }
        return result
    }
}