
package com.jayteealao.trails

//import com.jayteealao.trails.ui.adaptive.rememberListDetailSceneStrategy
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.scene.SceneStrategy
import androidx.navigation3.ui.NavDisplay
import com.jayteealao.trails.navigation.AppBackStack
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
import com.jayteealao.trails.ui.adaptive.DIALOG
import com.jayteealao.trails.ui.adaptive.DialogSceneStrategy
import com.jayteealao.trails.ui.adaptive.TrailsListDetailSceneStrategy
import com.jayteealao.trails.ui.adaptive.rememberTrailsListDetailSceneStrategy
import kotlinx.coroutines.flow.map

@OptIn(ExperimentalAnimationApi::class, ExperimentalMaterial3Api::class,
    ExperimentalMaterial3AdaptiveApi::class
)
@Composable
fun MainNavigation(
    modifier: Modifier = Modifier,
    authViewModel: AuthViewModel,
    articleDetailViewModel: ArticleDetailViewModel = hiltViewModel(),
    settingsViewModel: SettingsViewModel = hiltViewModel(),
) {
    val authState by authViewModel.state.collectAsState()
    // Cache the initial route calculation to prevent recomposition issues
    val initialRoute = remember(authState) {
        if (authState is AuthUiState.SignedIn) Screen.ArticleList else Screen.Login
    }
    val appBackStack = remember(initialRoute) { AppBackStack(initialRoute, Screen.Login) }
    val searchBarState = remember { SearchBarState(false) }

    val trailsListDetailSceneStrategy = rememberTrailsListDetailSceneStrategy<Screen>(
//        appBackStack = appBackStack
//        detailPlaceholder = { Text("Select an article to view details") }
    )
// Override the defaults so that there isn't a horizontal space between the panes.
    // See b/418201867
    val windowAdaptiveInfo = currentWindowAdaptiveInfo()
    val directive = remember(windowAdaptiveInfo) {
        calculatePaneScaffoldDirective(windowAdaptiveInfo)
            .copy(horizontalPartitionSpacerSize = 2.dp)
    }
    val listDetailSceneStrategy = rememberListDetailSceneStrategy<Screen>(directive = directive)


    val bottomSheetSceneStrategy = remember { BottomSheetSceneStrategy<Screen>() }
    val dialogSceneStrategy = remember { DialogSceneStrategy<Screen>() }

    @Suppress("UNCHECKED_CAST")
    val sceneStrategy = (
//            listDetailSceneStrategy
            trailsListDetailSceneStrategy
        .then(bottomSheetSceneStrategy)
        .then(dialogSceneStrategy)) as SceneStrategy<NavKey>

    TrailScaffold(
        topBar = { menuState ->
            // Show top bar when user is in the app (logged in OR skipped login)
            if (appBackStack.isLoggedIn) {
                TrailsTopAppBarNav3(
                    title = "Trails",
                    currentScreen = appBackStack.backStack.lastOrNull() ?: Screen.ArticleList,
                    menuState = menuState,
                    onNavigateBack = { appBackStack.remove() },
                    onNavigateToSearch = { appBackStack.add(Screen.ArticleSearch) },
                    onNavigateToSettings = { appBackStack.add(Screen.Settings) }
                )
            }
        }
    ) { paddingValues, _, snackbarHostState -> // TODO: pass in snackbarHostState
        NavDisplay(
            backStack = appBackStack.backStack,
            modifier = modifier.padding(paddingValues),
            onBack = { appBackStack.remove() },
            sceneStrategy = sceneStrategy,
            entryProvider = entryProvider {
            entry<Screen.Login> {
                AuthScreen(
                    onLoginSuccess = {
                        appBackStack.login()
                    }
                )
            }
            entry<Screen.ArticleList>(
                metadata = TrailsListDetailSceneStrategy.listPane()
//                metadata = ListDetailSceneStrategy.listPane(
//                    detailPlaceholder = { Text("Select an article to view details") }
//                )
            ) {
                ArticleListScreen(
                    onSelectArticle = { article ->
                        appBackStack.add(Screen.ArticleDetail(article.itemId))
                    },
                    onOpenTagManagement = { article ->
                        appBackStack.add(Screen.TagManagement(article.itemId))
                    }
                )
            }
            entry<Screen.ArticleDetail>(
                metadata = TrailsListDetailSceneStrategy.detailPane()
//                metadata = ListDetailSceneStrategy.detailPane()
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
                        appBackStack.add(Screen.ArticleDetail(article.itemId))
                    },
                )
            }
            entry<Screen.Settings> {
                SettingsScreen(
                    onLogout = {
                        appBackStack.logout()
                    },
                    onShowLogoutDialog = {
                        appBackStack.add(Screen.LogoutConfirmation)
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
                        appBackStack.remove() // Close dialog
                        authViewModel.signOut() // Update auth state immediately
                        settingsViewModel.logout(clearData = false)
                    },
                    onLogoutAndClear = {
                        appBackStack.remove() // Close dialog
                        authViewModel.signOut() // Update auth state immediately
                        settingsViewModel.logout(clearData = true)
                    },
                    onDismiss = {
                        appBackStack.remove() // Close dialog
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
