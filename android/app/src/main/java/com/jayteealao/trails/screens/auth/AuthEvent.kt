package com.jayteealao.trails.screens.auth

import com.jayteealao.trails.screens.components.ErrorMessage

/**
 * One-time events for AuthScreen
 * Note: AuthUiState is already defined in AuthViewModel.kt and serves as the State
 */
sealed interface AuthEvent {
    data class ShowToast(val message: String) : AuthEvent

    /** The guest account now has a Google account; the library stayed. */
    data object Upgraded : AuthEvent

    /** The account upgrade failed; the guest is still signed in. */
    data class UpgradeFailed(val message: ErrorMessage) : AuthEvent
}
