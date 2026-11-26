package com.jayteealao.trails.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import javax.inject.Inject
import javax.inject.Singleton

/** How the app picks its theme. */
enum class ThemeChoice {
    SYSTEM,
    LIGHT,
    DARK;

    /** Whether the app is dark on a phone that is dark or not. */
    fun isDark(systemDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemDark
        LIGHT -> false
        DARK -> true
    }
}

/**
 * The saved theme choice. With none saved, the old Dark mode switch decides: On is Dark. A saved
 * Off looks the same as a switch that was never used, so it is System. The old value is only read,
 * so the rule gives the same answer on every start and an older build still finds its value.
 */
@Singleton
class ThemePreference @Inject constructor(
    private val preferences: SharedPreferencesManager,
) {
    fun current(): ThemeChoice {
        val saved = preferences.getString(SettingsPreferenceKeys.THEME_CHOICE)
        return ThemeChoice.entries.find { it.name == saved }
            ?: if (preferences.getBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED)) {
                ThemeChoice.DARK
            } else {
                ThemeChoice.SYSTEM
            }
    }

    /** The choice now, then each change of it, a cleared one included. */
    val choices: Flow<ThemeChoice> = preferences.valueFlow(
        SettingsPreferenceKeys.THEME_CHOICE,
        SettingsPreferenceKeys.DARK_MODE_ENABLED,
        read = ::current,
    ).distinctUntilChanged()

    fun set(choice: ThemeChoice) {
        preferences.saveString(SettingsPreferenceKeys.THEME_CHOICE, choice.name)
    }
}
