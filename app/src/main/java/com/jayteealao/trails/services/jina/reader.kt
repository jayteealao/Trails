package com.jayteealao.trails.services.jina

import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.data.SharedPreferencesManager
import com.skydoves.sandwich.ApiResponse
import com.skydoves.sandwich.getOrNull
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.Headers
import retrofit2.http.POST
import javax.inject.Inject

data class UrlRequest(
    val url: String
)

data class ReaderResponse(
    val code: Int,
    val status: Int,
    val data: ReaderData
)

data class ReaderData(
    val title: String,
    val description: String,
    val url: String,
    val content: String,
    val usage: Map<String, Int>
)

interface JinaService {

    @Headers(
//        "Authorization: Bearer jina_fb4f53d07d3e4999acbad5ced4d6a52bkN7RQ7rs_N1L-PEzPFgdkR0aA9eM",
        "X-Return-Format: markdown",
        "Accept: application/json",
        "Content-Type: application/json",
        "X-With-Generated-Alt: true",
    )
    @POST("/")
    suspend fun getReader(
        @Header("Authorization") authorization: String? = null,
        @Body url: UrlRequest
    ): ApiResponse<ReaderResponse>
}

class JinaClient @Inject constructor(
    private val jinaService: JinaService,
    private val sharedPreferencesManager: SharedPreferencesManager
) {
//    suspend fun getReader(url: String) = jinaService.getReader(url)

    private val _jinaToken = sharedPreferencesManager.getString("JINA_TOKEN")
    val jinaToken: String?
        get() {
            return if (_jinaToken != null) {
                "Bearer $_jinaToken"
            } else {
                _jinaToken
            }
        }

    val urlModifier = UrlModifier()

    suspend fun getReader(url: String): ReaderResponse? {
        val modifiedUrl = urlModifier.modifyUrl(url)
        val urlRequest = UrlRequest(modifiedUrl)
        return jinaService.getReader(authorization = jinaToken, url = urlRequest).getOrNull()
    }

}