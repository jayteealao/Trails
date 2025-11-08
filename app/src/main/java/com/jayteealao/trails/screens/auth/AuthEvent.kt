package com.jayteealao.trails.screens.auth

/**
 * One-time events for AuthScreen
 * Note: AuthUiState is already defined in AuthViewModel.kt and serves as the State
 */
sealed interface AuthEvent {
    data class ShowError(val message: String) : AuthEvent
    data class ShowToast(val message: String) : AuthEvent
}
