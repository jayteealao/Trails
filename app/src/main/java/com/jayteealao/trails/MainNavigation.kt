
package com.jayteealao.trails

import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.ui.NavDisplay
import com.jayteealao.trails.screens.Screen
import com.jayteealao.trails.screens.TrailScaffold
import com.jayteealao.trails.screens.TrailsTopAppBarNav3
import com.jayteealao.trails.screens.articleDetail.ArticleDetailScreen
import com.jayteealao.trails.screens.articleDetail.ArticleDetailViewModel
import com.jayteealao.trails.screens.articleList.ArticleListScreen
import com.jayteealao.trails.screens.articleSearch.ArticleSearchScreen
import com.jayteealao.trails.screens.auth.AuthScreen
import com.jayteealao.trails.screens.auth.AuthUiState
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.screens.settings.LogoutConfirmationDialog
import com.jayteealao.trails.screens.settings.SettingsScreen
import com.jayteealao.trails.screens.settings.SettingsViewModel
import com.jayteealao.trails.screens.tagManagement.TagManagementScreen
import com.jayteealao.trails.ui.adaptive.BOTTOM_SHEET
import com.jayteealao.trails.ui.adaptive.BottomSheetSceneStrategy
import com.jayteealao.trails.ui.adaptive.DETAIL_PANE
import com.jayteealao.trails.ui.adaptive.DIALOG
import com.jayteealao.trails.ui.adaptive.DialogSceneStrategy
import com.jayteealao.trails.ui.adaptive.LIST_PANE
import com.jayteealao.trails.ui.adaptive.rememberListDetailSceneStrategy
import kotlinx.coroutines.flow.map

@OptIn(ExperimentalAnimationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun MainNavigation(
    modifier: Modifier = Modifier,
    authViewModel: AuthViewModel,
    articleDetailViewModel: ArticleDetailViewModel = hiltViewModel(),
    settingsViewModel: SettingsViewModel = hiltViewModel(),
) {
    val authState by authViewModel.state.collectAsState()
    val startRoute = if (authState is AuthUiState.SignedIn) Screen.ArticleList else Screen.Login
    val backStack = rememberNavBackStack(startRoute)
    val searchBarState = remember { SearchBarState(false) }
    val listDetailSceneStrategy = rememberListDetailSceneStrategy<Screen>(
        detailPlaceholder = { Text("Select an article to view details") }
    )
    val bottomSheetSceneStrategy = remember { BottomSheetSceneStrategy<Screen>() }
    val dialogSceneStrategy = remember { DialogSceneStrategy<Screen>() }
    @Suppress("UNCHECKED_CAST")
    val sceneStrategy = (listDetailSceneStrategy
        .then(bottomSheetSceneStrategy)
        .then(dialogSceneStrategy)) as SceneStrategy<NavKey>

    TrailScaffold(
        topBar = { menuState ->
            if (authState is AuthUiState.SignedIn) {
                TrailsTopAppBarNav3(
                    title = "Trails",
                    currentScreen = (backStack.lastOrNull() as? Screen) ?: Screen.ArticleList,
                    menuState = menuState,
                    onNavigateBack = { backStack.removeLastOrNull() },
                    onNavigateToSearch = { backStack.add(Screen.ArticleSearch) },
                    onNavigateToSettings = { backStack.add(Screen.Settings) }
                )
            }
        }
    ) { paddingValues, _, snackbarHostState -> // TODO: pass in snackbarHostState
        NavDisplay(
            backStack = backStack,
            modifier = modifier.padding(paddingValues),
            onBack = { backStack.removeLastOrNull() },
            sceneStrategy = sceneStrategy,
            entryProvider = entryProvider {
            entry<Screen.Login> {
                AuthScreen(
                    onLoginSuccess = {
                        backStack.clear()
                        backStack.add(Screen.ArticleList)
                    }
                )
            }
            entry<Screen.ArticleList>(
                metadata = mapOf(LIST_PANE to true)
            ) {
                ArticleListScreen(
                    onSelectArticle = { article ->
                        backStack.add(Screen.ArticleDetail(article.itemId))
                    },
                    onOpenTagManagement = { article ->
                        backStack.add(Screen.TagManagement(article.itemId))
                    }
                )
            }
            entry<Screen.ArticleDetail>(
                metadata = mapOf(DETAIL_PANE to true)
            ) { key ->
                val articleId = key.id
                articleDetailViewModel.getArticle(articleId)
                val selectedArticle by articleDetailViewModel.state.map { it.article }.collectAsState(null)

                selectedArticle?.let { ArticleDetailScreen(article = it) }
            }
            entry<Screen.ArticleSearch> {
                ArticleSearchScreen(
                    searchBarState = searchBarState,
                    onSelectArticle = { article ->
                        backStack.add(Screen.ArticleDetail(article.itemId))
                    },
                )
            }
            entry<Screen.Settings> {
                SettingsScreen(
                    onLogout = {
                        backStack.clear()
                        backStack.add(Screen.Login)
                    },
                    onShowLogoutDialog = {
                        backStack.add(Screen.LogoutConfirmation)
                    },
                    onUpgradeAccount = { credential ->
                        authViewModel.linkWithCredential(credential)
                    }
                )
            }
            entry<Screen.LogoutConfirmation>(
                metadata = mapOf(DIALOG to DialogProperties())
            ) {
                LogoutConfirmationDialog(
                    onLogoutOnly = {
                        backStack.removeLastOrNull() // Close dialog
                        settingsViewModel.logout(clearData = false)
                    },
                    onLogoutAndClear = {
                        backStack.removeLastOrNull() // Close dialog
                        settingsViewModel.logout(clearData = true)
                    },
                    onDismiss = {
                        backStack.removeLastOrNull() // Close dialog
                    }
                )
            }
            entry<Screen.TagManagement>(
                metadata = mapOf(BOTTOM_SHEET to ModalBottomSheetProperties())
            ) { key ->
                val articleId = key.articleId
                TagManagementScreen(articleId = articleId)
            }
        }
        )
    }
}
