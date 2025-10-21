package com.jayteealao.trails.usecases

import com.jayteealao.trails.network.article.ArticleClient
import com.skydoves.sandwich.messageOrNull
import com.skydoves.sandwich.suspendOnError
import com.skydoves.sandwich.suspendOnSuccess
import timber.log.Timber
import javax.inject.Inject

class GetAccessTokenFromNetworkUseCase @Inject constructor(
    private val articleClient: ArticleClient,
    private val setAccessTokenUseCase: SetAccessTokenUseCase
) {
    suspend operator fun invoke(consumerKey: String, requestToken: String): Result<String> {
//        if (sharedPreferences.getString(ACCESSTOKEN) != null) {
//            return Result.success(sharedPreferences.getString(ACCESSTOKEN)!!)
//        }
        var result: Result<String> = Result.failure(Throwable("Error failed for bug"))
        articleClient.getAccessToken(consumerKey, requestToken).suspendOnSuccess {
            data.accessToken?.let { accessToken ->
                setAccessTokenUseCase(accessToken)
                result = Result.success(accessToken)
            }
        }.suspendOnError {
            Timber.d(response.errorBody()?.string())
            result = Result.failure(Throwable(messageOrNull))
        }
        return result
    }
}

