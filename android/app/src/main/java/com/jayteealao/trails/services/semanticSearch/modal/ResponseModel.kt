package com.jayteealao.trails.services.semanticSearch.modal

import com.google.gson.annotations.SerializedName

data class ResponseModel(
    val id: String,
    val distance: Double?,
    val score: Double?,
    @SerializedName("explain_score") val explainScore: String?,
)

data class ResponseModel2(
    val data: Map<String, String>
)