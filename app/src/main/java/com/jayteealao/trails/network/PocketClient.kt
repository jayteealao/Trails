package com.jayteealao.trails.network

import javax.inject.Inject

class PocketClient @Inject constructor(
    private val pocketService: PocketService
) {
    suspend fun getRequestToken(consumerKey: String, redirectUri: String) =
        pocketService.getRequestToken(consumerKey, redirectUri)

//    suspend fun authorize(requestToken: String, redirectUri: String) =
//        pocketService.authorize(requestToken, redirectUri)

    suspend fun getAccessToken(consumerKey: String, requestToken: String) =
        pocketService.getAccessToken(consumerKey, requestToken)

    suspend fun retrieve(params: Map<String, String>) =
        pocketService.retrieve(params)
}