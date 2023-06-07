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

import android.content.Context
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.jayteealao.shared.main
import com.jayteealao.trails.ui.TrailScaffold
import com.jayteealao.trails.ui.TrailsTopAppBar
import com.jayteealao.trails.ui.article.ArticleScreen
import com.jayteealao.trails.ui.article.ArticleViewModel
import com.jayteealao.trails.ui.auth.AuthScreen
import com.jayteealao.trails.ui.auth.AuthViewModel
import com.jayteealao.trails.ui.pocket.PocketScreen
import com.jayteealao.trails.ui.pocket.PocketViewModel
import timber.log.Timber

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun MainNavigation(
    authViewModel: AuthViewModel,
    pocketViewModel: PocketViewModel = hiltViewModel(),
    articleViewModel: ArticleViewModel = hiltViewModel()
) {
    val navController = rememberNavController()
    val route = navController.currentBackStackEntryAsState()
    val _isLoggedIn = authViewModel.isLoggedIn
    var isLoggedIn by remember { mutableStateOf(false) }
    val searchBarState by remember { mutableStateOf(SearchBarState(false)) }

    LaunchedEffect(true) {
        _isLoggedIn.collect { value ->
            isLoggedIn = value
        }
    }

    LaunchedEffect(isLoggedIn) {
        if (isLoggedIn) {
            pocketViewModel.sync()
        }
    }

    LaunchedEffect(true) {
        main()
    }
    TrailScaffold(
        topBar = {
            searchBarState.rememberSearchBarTransition().AnimatedVisibility(visible = { !searchBarState.searchBarActive }) {
                TrailsTopAppBar(
                    title = "Trails",
                    navController = navController,
                    route = route,
                    menuState = it
                )
            }
        }
    ){ paddingValues, transitionData ->
        NavHost(
            modifier = Modifier
                .padding(paddingValues),
            navController = navController,
            startDestination = if (isLoggedIn) "main" else "login"
        ) {
            composable("login") {
                AuthScreen(
                    navController = navController,
                    modifier = Modifier
                        .padding(16.dp)
                        .fillMaxSize(),
                    viewModel = authViewModel
                )
            }
            composable("main") {
                Box(
                    modifier = Modifier
                        .graphicsLayer {
                            scaleX = transitionData.scale
                            scaleY = transitionData.scale
                            translationX = transitionData.offset * 100
                        }
                ){
                    val context = LocalContext.current
                    PocketScreen(
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surface),
                        viewModel = pocketViewModel,
                        onSelectArticle = { article ->
                            navController.navigate("article/${article.itemId}")
//                            OpenChromeCustomTab(context, "https://getpocket.com/read/${article.itemId}")
                        },
                        searchBarState = searchBarState,
                    )
                }
            }
            composable("article/{articleId}") { backStackEntry ->
                val articleId = backStackEntry.arguments?.getString("articleId")
                if (articleId == null) {
                    Timber.e("Article ID is null")
                    return@composable
                }
                articleViewModel.getArticle(articleId)
                ArticleScreen(
                    articleViewModel = articleViewModel,
                    articleId = articleId,
                )
            }
            // TODO: Add more destinations
        }
    }
}

class SearchBarState(
    searchBarActive: Boolean,
) {

    var searchText by mutableStateOf("")

    var searchBarActive by mutableStateOf(searchBarActive)
    private val transition: Transition<Boolean>? = null

    @Composable
    fun rememberSearchBarTransition(): Transition<Boolean> {
        return transition ?: updateTransition(targetState = searchBarActive, label = "searchBarTransition")
    }

    fun updateSearchText(text: String) {
        searchText = text
    }

    @Composable
    fun searchBarContainerColor() = rememberSearchBarTransition().animateColor(label = "searchBarContainerColor") {
        if (it) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        }
    }
}

fun OpenChromeCustomTab(context: Context, url: String) {
//    val context = LocalContext.current
//    val toolbarColor = MaterialTheme.colorScheme.primary
    val builder = CustomTabsIntent.Builder().apply {
//        setToolbarColor(toolbarColor)
    }
    val customTabsIntent = builder.build()
    customTabsIntent.intent.`package` = "com.android.chrome"
    customTabsIntent.launchUrl(context, url.toUri())
}

