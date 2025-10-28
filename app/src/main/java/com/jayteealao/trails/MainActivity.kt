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

package com.jayteealao.trails

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import coil3.ImageLoader
import coil3.compose.setSingletonImageLoaderFactory
import coil3.request.crossfade
import com.jayteealao.trails.data.local.preferences.UserPreferencesRepository
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.screens.settings.SettingsViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var preferencesRepository: UserPreferencesRepository

    private val authViewModel by viewModels<AuthViewModel>()
    private val settingsViewModel by viewModels<SettingsViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
//        enableEdgeToEdge()
        WindowCompat.enableEdgeToEdge(window)
        var exitSplash = false
        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                delay(1000) // wait 5 seconds
                exitSplash = true
            }
        }
        super.onCreate(savedInstanceState)
        val splashScreen = installSplashScreen()

//        val uiState = authViewModel.uiState

        splashScreen.setKeepOnScreenCondition {
            !exitSplash
        }


        setContent {
            val darkThemeEnabled by settingsViewModel.darkTheme.collectAsStateWithLifecycle()
            TrailsTheme(darkTheme = darkThemeEnabled) {
                setSingletonImageLoaderFactory { context ->
                    ImageLoader.Builder(context)
                        .crossfade(true)
                        .build()
                }
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainNavigation(
                        authViewModel = authViewModel,
                        preferencesRepository = preferencesRepository,
                        settingsViewModel = settingsViewModel,
                    )
                }
            }
        }
    }
}
