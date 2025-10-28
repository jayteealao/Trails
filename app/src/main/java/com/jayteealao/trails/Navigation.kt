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
import android.content.res.Configuration
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.jayteealao.trails.screens.MenuState
import com.jayteealao.trails.screens.TrailScaffold
import com.jayteealao.trails.screens.TrailsTopAppBar
import com.jayteealao.trails.screens.articleDetail.ArticleDetailScreen
import com.jayteealao.trails.screens.articleDetail.ArticleDetailViewModel
import com.jayteealao.trails.screens.articleList.ArticleListScreen
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.articleList.ArticleSortOption
import com.jayteealao.trails.screens.articleList.PocketScreenContent
import com.jayteealao.trails.screens.articleSearch.ArticleSearchContent
import com.jayteealao.trails.screens.articleSearch.ArticleSearchScreen
import com.jayteealao.trails.screens.articleSearch.ArticleSearchViewModel
import com.jayteealao.trails.screens.auth.AuthScreen
import com.jayteealao.trails.screens.auth.AuthScreenContent
import com.jayteealao.trails.screens.auth.AuthUiState
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.preview.previewSearchBarState
import com.jayteealao.trails.screens.preview.rememberPreviewArticles
import com.jayteealao.trails.screens.settings.SettingsScreen
import com.jayteealao.trails.screens.settings.SettingsScreenContent
import com.jayteealao.trails.screens.settings.SettingsViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import timber.log.Timber

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun MainNavigation(
    authViewModel: AuthViewModel,
    articleListViewModel: ArticleListViewModel = hiltViewModel(),
    articleDetailViewModel: ArticleDetailViewModel = hiltViewModel(),
    articleSearchViewModel: ArticleSearchViewModel = hiltViewModel(),
    settingsViewModel: SettingsViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()
    val route = navController.currentBackStackEntryAsState()
    val _isLoggedIn = authViewModel.isLoggedIn
    var isLoggedIn by remember { mutableStateOf(false) }
    val searchBarState by remember { mutableStateOf(SearchBarState(false)) }
    val selectedArticle by articleDetailViewModel.article.collectAsState()
    val useCardLayout by settingsViewModel.useCardLayout.collectAsState()

    LaunchedEffect(true) {
        _isLoggedIn.collect { value ->
            isLoggedIn = value
        }
    }

    LaunchedEffect(isLoggedIn) {
        if (isLoggedIn) {
//            articleListViewModel.sync()
        }
    }
    TrailScaffold(
        topBar = {
            searchBarState.rememberSearchBarTransition().AnimatedVisibility(visible = { !searchBarState.searchBarActive }) {
                TrailsTopAppBar(
                    title = "Trails",
                    navController = navController,
                    route = route,
                    menuState = it,
                )
            }
        }
    ){ paddingValues, transitionData ->
        NavHost(
            modifier = Modifier
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.background),
            navController = navController,
            startDestination = "main"
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
                    ArticleListScreen(
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surface),
                        viewModel = articleListViewModel,
                        onSelectArticle = { article ->
                            navController.navigate("article/${article.itemId}")
                        },
                        useCardLayout = useCardLayout
                    )
                }
            }
            composable("article/{articleId}") { backStackEntry ->
                val articleId = backStackEntry.arguments?.getString("articleId")
                if (articleId == null) {
                    Timber.e("Article ID is null")
                    return@composable
                }
                articleDetailViewModel.getArticle(articleId)

                selectedArticle?.let { ArticleDetailScreen(article = it) }
            }
            composable("search") {
                ArticleSearchScreen(
                    searchBarState = searchBarState,
                    viewModel = articleSearchViewModel,
                    onSelectArticle = { article ->
                        navController.navigate("article/${article.itemId}")
                    },
                    useCardLayout = useCardLayout
                )
            }

            composable("settings") {
                SettingsScreen(
                    modifier = Modifier
                        .padding(16.dp)
                        .fillMaxSize(),
                    settingsViewModel = settingsViewModel
                )
            }
            // TODO: Add more destinations
        }
    }
}

@Preview(name = "Navigation • Main Flow", showBackground = true)
@Composable
private fun MainNavigationPreview() {
    TrailsTheme {
        val navController = rememberNavController()
        val route = navController.currentBackStackEntryAsState()
        val searchBarState = remember { previewSearchBarState() }
        val previewArticles = rememberPreviewArticles()

        TrailScaffold(
            topBar = { menuState ->
                searchBarState.rememberSearchBarTransition().AnimatedVisibility(visible = { !searchBarState.searchBarActive }) {
                    TrailsTopAppBar(
                        title = "Trails",
                        navController = navController,
                        route = route,
                        menuState = menuState,
                    )
                }
            }
        ) { paddingValues, transitionData ->
            NavHost(
                modifier = Modifier
                    .padding(paddingValues)
                    .background(MaterialTheme.colorScheme.background),
                navController = navController,
                startDestination = "main",
            ) {
                composable("login") {
                    AuthScreenContent(
                        modifier = Modifier
                            .padding(16.dp)
                            .fillMaxSize(),
                        uiState = AuthUiState.NeedAuth,
                        onGetRequestToken = {},
                        onAuthorize = {},
                        onGetAccessToken = {},
                        onNavigateToMain = {},
                    )
                }
                composable("main") {
                    Box(
                        modifier = Modifier.graphicsLayer {
                            scaleX = transitionData.scale
                            scaleY = transitionData.scale
                            translationX = transitionData.offset * 100
                        }
                    ) {
                        PocketScreenContent(
                            lazyItems = previewArticles,
                            sortOption = ArticleSortOption.Newest,
                            onSortSelected = {},
                            onSelectArticle = { navController.navigate("article") },
                            onToggleFavorite = { _, _ -> },
                            onToggleTag = { _, _, _ -> },
                            onArchive = {},
                            onDelete = {},
                            useCardLayout = true,
                            availableTags = emptyList(),
                            tagSuggestionStates = emptyMap(),
                            onRequestTagSuggestions = {},
                            onClearSuggestionError = {}
                        )
                    }
                }
                composable("article") {
                    ArticleDetailScreen(article = PreviewFixtures.pocketArticle)
                }
                composable("search") {
                    ArticleSearchContent(
                        modifier = Modifier.fillMaxSize(),
                        searchBarState = searchBarState,
                        searchResults = PreviewFixtures.articleList,
                        onQueryChange = {},
                        onSearch = {},
                        onActiveChange = { searchBarState.searchBarActive = it },
                        onSelectArticle = {},
                        useCardLayout = true,
                    )
                }
                composable("settings") {
                    SettingsScreenContent(
                        modifier = Modifier
                            .padding(16.dp)
                            .fillMaxSize(),
                        useFreedium = true,
                        darkThemeEnabled = false,
                        useCardLayout = true,
                        jinaToken = PreviewFixtures.authAccessToken,
                        jinaPlaceholder = "Insert Jina Token Here",
                        onResetSemanticCache = {},
                        onToggleFreedium = {},
                        onToggleDarkTheme = {},
                        onToggleCardLayout = {},
                        onJinaTokenChange = {},
                        onSubmitJinaToken = {},
                    )
                }
            }
        }
    }
}

@Preview(
    name = "Navigation • Dark",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun MainNavigationDarkPreview() {
    TrailsTheme(darkTheme = true) {
        val navController = rememberNavController()
        val route = navController.currentBackStackEntryAsState()
        val searchBarState = remember { previewSearchBarState(active = true) }
        val previewArticles = rememberPreviewArticles()

        TrailScaffold(
            topBar = { menuState ->
                menuState.value = MenuState.Closed
                searchBarState.rememberSearchBarTransition().AnimatedVisibility(visible = { !searchBarState.searchBarActive }) {
                    TrailsTopAppBar(
                        title = "Trails",
                        navController = navController,
                        route = route,
                        menuState = menuState,
                    )
                }
            }
        ) { paddingValues, _ ->
            NavHost(
                modifier = Modifier
                    .padding(paddingValues)
                    .background(MaterialTheme.colorScheme.background),
                navController = navController,
                startDestination = "main",
            ) {
                composable("main") {
                    PocketScreenContent(
                        lazyItems = previewArticles,
                        sortOption = ArticleSortOption.Newest,
                        onSortSelected = {},
                        onSelectArticle = {},
                        onToggleFavorite = { _, _ -> },
                        onToggleTag = { _, _, _ -> },
                        onArchive = {},
                        onDelete = {},
                        useCardLayout = true,
                        availableTags = emptyList(),
                        tagSuggestionStates = emptyMap(),
                        onRequestTagSuggestions = {},
                        onClearSuggestionError = {}
                    )
                }
                composable("article") {
                    ArticleDetailScreen(article = PreviewFixtures.pocketArticle)
                }
            }
        }
    }
}

class SearchBarState(
    searchBarActive: Boolean,
    private val onSearch: (String) -> Unit = { },
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

    fun search(text: String) = onSearch(text)
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

