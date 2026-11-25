package com.jayteealao.trails.screens.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jayteealao.trails.data.ThemePreference

/**
 * Whether the app is dark now: the saved choice and the phone as one value. It starts from the
 * saved choice, so the first frame has the right theme, and follows both while it is composed.
 */
@Composable
fun rememberDarkTheme(preference: ThemePreference): Boolean {
    val first = remember(preference) { preference.current() }
    val choice by preference.choices.collectAsStateWithLifecycle(initialValue = first)
    return choice.isDark(isSystemInDarkTheme())
}
