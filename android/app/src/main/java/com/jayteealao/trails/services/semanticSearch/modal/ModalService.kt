package com.jayteealao.trails.services.semanticSearch.modal

import com.jayteealao.trails.data.models.PocketSummary
import com.skydoves.sandwich.ApiResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import javax.inject.Inject

interface ModalService {
    @POST("/add_article")
    suspend fun addObject(
        @Body article: ModalArticle
    ): ApiResponse<ResponseModel>

    @POST("/add_articles")
    suspend fun addObjects(
        @Body articles: List<ModalArticle>
    ): ApiResponse<ResponseModel2>

    @GET("/delete_all")
    suspend fun deleteAll(): ApiResponse<ResponseModel>

    @GET("/search_hybrid")
    suspend fun searchHybrid(
        @Query("search_query") searchQuery: String
    ): ApiResponse<List<ResponseModel>>

    @POST("/create_summaries")
    suspend fun summarize(
        @Body article: List<ModalArticle>
    ): ApiResponse<List<PocketSummary>>
}

data class ModalArticle(
    val id: String,
    val text: String
)

data class SummaryRequest(
    val text: String
)

data class SummaryResponse(
    val summary: String
)

class ModalClient @Inject constructor(
    private val modalService: ModalService
) {
    suspend fun addArticle(article: ModalArticle) = modalService.addObject(article)

    suspend fun addArticles(articles: List<ModalArticle>) = modalService.addObjects(articles)

    suspend fun deleteAll() = modalService.deleteAll()

    suspend fun searchHybrid(query: String) = modalService.searchHybrid(query)

    suspend fun summarize(articles: List<ModalArticle>) = modalService.summarize(articles)
}