/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.jayteealao.trails.screens.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.createFontFamilyResolver
import androidx.core.view.ViewCompat

private val DarkColorScheme = darkColorScheme(
    primary = TrailsSky,
    onPrimary = TrailsNavy,
    primaryContainer = TrailsAquaDeep,
    onPrimaryContainer = TrailsMist,
    secondary = TrailsCyanBright,
    onSecondary = TrailsNavy,
    secondaryContainer = TrailsTealDeep,
    onSecondaryContainer = TrailsMist,
    tertiary = TrailsSkySoft,
    onTertiary = TrailsNavy,
    tertiaryContainer = TrailsOcean,
    onTertiaryContainer = TrailsMist,
    background = TrailsInk,
    onBackground = TrailsMist,
    surface = TrailsMidnight,
    onSurface = TrailsMist,
    surfaceVariant = TrailsMidnightVariant,
    onSurfaceVariant = TrailsOutlineBright,
    outline = TrailsOutline,
    outlineVariant = TrailsOutlineDark,
    inverseSurface = TrailsMist,
    inverseOnSurface = TrailsInk,
    inversePrimary = TrailsIndigo,
    surfaceTint = TrailsSky,
    scrim = Color(0xCC000000),
    error = TrailsError,
    onError = TrailsOnError,
    errorContainer = TrailsErrorContainer,
    onErrorContainer = TrailsOnErrorContainer,
)

private val LightColorScheme = lightColorScheme(
    primary = TrailsIndigo,
    onPrimary = Color.White,
    primaryContainer = TrailsMist,
    onPrimaryContainer = TrailsNavy,
    secondary = TrailsSky,
    onSecondary = TrailsInk,
    secondaryContainer = TrailsSkySoft,
    onSecondaryContainer = TrailsNavy,
    tertiary = TrailsOcean,
    onTertiary = Color.White,
    tertiaryContainer = TrailsSkySoft,
    onTertiaryContainer = TrailsNavy,
    background = TrailsCloud,
    onBackground = TrailsInk,
    surface = Color.White,
    onSurface = TrailsInk,
    surfaceVariant = TrailsIce,
    onSurfaceVariant = TrailsOutline,
    outline = TrailsOutline,
    outlineVariant = TrailsOutlineBright,
    inverseSurface = TrailsInk,
    inverseOnSurface = TrailsMist,
    inversePrimary = TrailsSky,
    surfaceTint = TrailsIndigo,
    scrim = Color(0x66000000),
    error = TrailsError,
    onError = TrailsOnError,
    errorContainer = TrailsErrorContainer,
    onErrorContainer = TrailsOnErrorContainer,
)

@Composable
fun TrailsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Dynamic color is available on Android 12+
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            (view.context as Activity).window.statusBarColor = Color.Transparent.toArgb()
            (view.context as Activity).window.navigationBarColor = Color.Transparent.toArgb()
            ViewCompat.getWindowInsetsController(view)?.isAppearanceLightStatusBars = !darkTheme
            ViewCompat.getWindowInsetsController(view)?.isAppearanceLightNavigationBars = !darkTheme
        }
    }


    CompositionLocalProvider(
        LocalFontFamilyResolver provides createFontFamilyResolver(LocalContext.current, fontHandler)
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            content = content
        )
    }
}
