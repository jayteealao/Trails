package com.jayteealao.trails.screens

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable
sealed class Screen : NavKey {
    @Serializable
    data object ArticleList : Screen()
    @Serializable
    data class ArticleDetail(val id: String) : Screen()
    @Serializable
    data object ArticleSearch : Screen()
    @Serializable
    data object Settings : Screen()
    @Serializable
    data object Login : Screen()
    @Serializable
    data class TagManagement(val articleId: String) : Screen()
    @Serializable
    data object LogoutConfirmation : Screen()
}