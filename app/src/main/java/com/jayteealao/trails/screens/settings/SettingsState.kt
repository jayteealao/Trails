package com.jayteealao.trails.screens.settings

/**
 * Consolidated UI state for SettingsScreen
 */
data class SettingsState(
    val useFreedium: Boolean = false,
    val darkTheme: Boolean = false,
    val useCardLayout: Boolean = false,
    val jinaToken: String = "",
    val jinaPlaceholder: String = "Insert Jina Token Here",
    val versionName: String = "",
    val versionCode: Int = 0
)

/**
 * One-time events for SettingsScreen
 */
sealed interface SettingsEvent {
    data class ShowToast(val message: String) : SettingsEvent
    data object SemanticCacheCleared : SettingsEvent
    data object JinaTokenSaved : SettingsEvent
}
