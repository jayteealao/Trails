package com.jayteealao.trails.services.postgrest

import com.jayteealao.trails.data.local.database.Article
import com.skydoves.sandwich.ApiResponse
import com.skydoves.sandwich.isSuccess
import com.skydoves.sandwich.retrofit.statusCode
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.POST
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

interface PostgrestService {
    @Headers(
        "Content-Type: application/json",
        "Prefer: resolution=merge-duplicates",
        "CF-Access-Client-Id: 90553d7d92950e65225ae516090880ab.access",
        "CF-Access-Client-Secret: 94fdc766f15aa558a64885ca9635ab5f5bcbc8d0dd4b943cf7a3574eb7f18e25"
    )
    @POST("/article")
    suspend fun addArticle(@Body article: Article): Response<Unit>

    @Headers(
        "Content-Type: application/json",
        "Prefer: resolution=merge-duplicates",
        "CF-Access-Client-Id: 90553d7d92950e65225ae516090880ab.access",
        "CF-Access-Client-Secret: 94fdc766f15aa558a64885ca9635ab5f5bcbc8d0dd4b943cf7a3574eb7f18e25"
    )
    @POST("/article?on_conflict=itemId")
    suspend fun addArticles(@Body articles: List<Article>): ApiResponse<Unit>

    @Headers(
        "Content-Type: application/json",
        "Prefer: count=planned",
        "CF-Access-Client-Id: 90553d7d92950e65225ae516090880ab.access",
        "CF-Access-Client-Secret: 94fdc766f15aa558a64885ca9635ab5f5bcbc8d0dd4b943cf7a3574eb7f18e25"
    )
    @GET("/article?limit=2")
    suspend fun countArticles(): Response<Unit>
}

@Singleton
class PostgrestClient @Inject constructor (
    private val api: PostgrestService,
) {
    suspend fun sendArticle(article: Article): Boolean {
        val response = api.addArticle(article)
        return response.isSuccessful
    }

    suspend fun sendArticles(articles: List<Article>): Boolean {
        var lastResponse: ApiResponse<Unit>? = null

        // Retry logic for server errors (502, 503, 504)
        for (attempt in 0 until 3) {
            try {
                lastResponse = api.addArticles(articles)

                // Success - return immediately
                if (lastResponse?.isSuccess == true) {
                    return true
                }

                // Check if it's a server error worth retrying
                val shouldRetry = when (lastResponse) {
                    is ApiResponse.Failure.Error -> {
                        val errorResponse = lastResponse
                        val errorCode = errorResponse.statusCode.code
                        Timber.d("Error code: $errorCode")
                        errorCode in listOf(502, 503, 504) // Bad Gateway, Service Unavailable, Gateway Timeout
                    }
                    is ApiResponse.Failure.Exception -> true // Network errors
                    else -> false
                }

                if (shouldRetry && attempt < 2) {
                    // Exponential backoff: 1s, 2s
                    kotlinx.coroutines.delay(1000L * (attempt + 1))
                } else {
                    // Don't retry for 4xx errors or if we've exhausted retries
                    break
                }
            } catch (e: Exception) {
                if (attempt == 2) throw e // Throw on last attempt
                kotlinx.coroutines.delay(1000L * (attempt + 1))
            }
        }

        return lastResponse?.isSuccess ?: false
    }

    suspend fun countArticles(): Int {
        val response = api.countArticles()
//        fetch count from headers
        val countHeader = response.headers()["Content-Range"]
        return countHeader?.split("/")?.getOrNull(1)?.toIntOrNull() ?: 0

    }
}