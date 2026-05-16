package com.jayteealao.trails.network

import com.google.gson.annotations.SerializedName

data class AuthResponseModel(
    @SerializedName("access_token") val accessToken: String? = null,
    val code: String,
    val username: String? = null,
)
