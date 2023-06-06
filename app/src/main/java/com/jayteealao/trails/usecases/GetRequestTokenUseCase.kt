package com.jayteealao.trails.usecases

import com.jayteealao.trails.network.PocketClient
import javax.inject.Inject

class GetRequestTokenUseCase @Inject constructor(
    private val pocketClient: PocketClient
) {
    suspend operator fun invoke(consumerKey: String, redirectUri: String) =
        pocketClient.getRequestToken(consumerKey, redirectUri)
}