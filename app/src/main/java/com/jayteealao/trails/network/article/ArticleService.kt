package com.jayteealao.trails.network.article

import com.jayteealao.trails.network.ArticlesResponseModel
import com.jayteealao.trails.network.AuthResponseModel
import com.skydoves.sandwich.ApiResponse
import retrofit2.http.Field
import retrofit2.http.FieldMap
import retrofit2.http.FormUrlEncoded
import retrofit2.http.POST


interface ArticleService {

    @POST("oauth/request")
    @FormUrlEncoded
    suspend fun getRequestToken(
        @Field("consumer_key") consumerKey: String,
        @Field("redirect_uri") redirectUri: String
    ): ApiResponse<AuthResponseModel>

    @POST("oauth/authorize")
    @FormUrlEncoded
    suspend fun getAccessToken(
        @Field("consumer_key") consumerKey: String,
        @Field("code") requestToken: String
    ): ApiResponse<AuthResponseModel>

    @POST("get")
    @FormUrlEncoded
    suspend fun retrieve(
        @FieldMap params: Map<String, String>
    ): ApiResponse<ArticlesResponseModel>
}
