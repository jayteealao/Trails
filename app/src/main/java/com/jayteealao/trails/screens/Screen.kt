package com.jayteealao.trails.screens

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable
sealed class Screen : NavKey {
    // Marker interface for screens that require authentication
    interface RequiresAuth

    @Serializable
    data object ArticleList : Screen(), RequiresAuth
    @Serializable
    data class ArticleDetail(val id: String) : Screen(), RequiresAuth
    @Serializable
    data object ArticleSearch : Screen(), RequiresAuth
    @Serializable
    data object Settings : Screen(), RequiresAuth
    @Serializable
    data object Login : Screen()
    @Serializable
    data class TagManagement(val articleId: String) : Screen(), RequiresAuth
    @Serializable
    data object LogoutConfirmation : Screen(), RequiresAuth
}