
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
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
import com.jayteealao.trails.screens.articleDetail.ArticleDetailPane
import com.jayteealao.trails.screens.articleDetail.ArticleDetailViewModel
import com.jayteealao.trails.screens.articleList.ArticleListScreen
import com.jayteealao.trails.screens.articleSearch.ArticleSearchScreen
import com.jayteealao.trails.screens.auth.AuthMessages
import com.jayteealao.trails.screens.auth.AuthScreen
import com.jayteealao.trails.screens.auth.AuthUiState
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.screens.auth.UpgradeState
import com.jayteealao.trails.screens.components.findActivity
import com.jayteealao.trails.screens.settings.LogoutConfirmationDialog
import com.jayteealao.trails.screens.settings.SettingsScreen
import com.jayteealao.trails.screens.settings.SettingsViewModel
import com.jayteealao.trails.screens.tagManagement.TagManagementScreen
import com.jayteealao.trails.testtags.MainNavTestTags
import com.jayteealao.trails.ui.adaptive.BOTTOM_SHEET
import com.jayteealao.trails.ui.adaptive.BottomSheetSceneStrategy
import com.jayteealao.trails.ui.adaptive.DIALOG
import com.jayteealao.trails.ui.adaptive.DialogSceneStrategy
import com.jayteealao.trails.ui.adaptive.TrailsListDetailSceneStrategy
import com.jayteealao.trails.ui.adaptive.rememberTrailsListDetailSceneStrategy
import io.yumemi.tartlet.rememberViewStore

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
    val upgrade by authViewModel.upgrade.collectAsState()
    // An upgrade keeps the person on Settings; the account row then reads the new account.
    LaunchedEffect(upgrade) {
        if (upgrade == UpgradeState.Done) settingsViewModel.accountChanged()
    }
    // Cache the initial route calculation to prevent recomposition issues
    val initialRoute = remember(authState) {
        if (authState is AuthUiState.SignedIn) Screen.ArticleList else Screen.Login
    }
    val appBackStack = remember(initialRoute) { AppBackStack(initialRoute, Screen.Login) }
    val searchBarState = remember { SearchBarState() }

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
    ) { paddingValues, _, snackbarHostState ->
        // An account upgrade runs from Settings, so its message is heard on every screen.
        AuthMessages(authViewModel, snackbarHostState)
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
                    },
                    // The activity's own view model: its state picks the first route.
                    authViewModel = authViewModel,
                )
            }
            entry<Screen.ArticleList>(
                metadata = TrailsListDetailSceneStrategy.listPane()
//                metadata = ListDetailSceneStrategy.listPane(
//                    detailPlaceholder = { Text("Select an article to view details") }
//                )
            ) {
                ArticleListScreen(
                    modifier = Modifier.testTag(MainNavTestTags.LIST_PANE),
                    onSelectArticle = { article ->
                        appBackStack.add(Screen.ArticleDetail(article.itemId))
                    },
                    onOpenTagManagement = { article ->
                        appBackStack.add(Screen.TagManagement(article.itemId))
                    },
                    // The login route alone; it clears no data, and Skip returns to the list.
                    onSignIn = { appBackStack.logout() },
                    onOpenSettings = { appBackStack.add(Screen.Settings) },
                )
            }
            entry<Screen.ArticleDetail>(
                metadata = TrailsListDetailSceneStrategy.detailPane()
//                metadata = ListDetailSceneStrategy.detailPane()
            ) { key ->
                ArticleDetailPane(
                    articleId = key.id,
                    viewModel = articleDetailViewModel,
                    modifier = Modifier.testTag(MainNavTestTags.DETAIL_PANE),
                )
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
                val activity = LocalContext.current.findActivity()
                SettingsScreen(
                    onLogout = {
                        // "Clear data" signs out only after its wipe; this updates the
                        // auth state for both logout choices.
                        authViewModel.signOut()
                        appBackStack.logout()
                    },
                    onShowLogoutDialog = {
                        appBackStack.add(Screen.LogoutConfirmation)
                    },
                    upgrading = upgrade == UpgradeState.Running,
                    onUpgradeAccount = { activity?.let { authViewModel.upgradeAccount(it) } },
                    // The same view model that hears of a finished upgrade.
                    viewStore = rememberViewStore { settingsViewModel },
                )
            }
            entry<Screen.LogoutConfirmation>(
                metadata = mapOf(DIALOG to DialogProperties())
            ) {
                LogoutConfirmationDialog(
                    onLogoutOnly = {
                        appBackStack.remove() // Close dialog
                        // No sign-out here: pending changes are pushed with the owner's
                        // session first; Settings signs out when it finishes.
                        settingsViewModel.logout(clearData = false)
                    },
                    onLogoutAndClear = {
                        appBackStack.remove() // Close dialog
                        // No sign-out here: pending changes are pushed with the owner's
                        // session before the wipe; Settings signs out when it finishes.
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
