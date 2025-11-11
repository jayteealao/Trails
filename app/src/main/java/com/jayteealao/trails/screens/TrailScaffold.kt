package com.jayteealao.trails.screens

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.compose.rememberNavController
import com.jayteealao.trails.R
import com.jayteealao.trails.Screen
import com.jayteealao.trails.screens.theme.TrailsTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrailScaffold(
    topBar : @Composable (MutableState<MenuState>) -> Unit = {},
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
    content: @Composable (PaddingValues, TransitionData, SnackbarHostState) -> Unit,
) {
    val menuState = remember { mutableStateOf( MenuState.Open )}
    val transitionData = updateTransitionData(menuState = menuState.value)

    Scaffold(
        topBar = { topBar(menuState) },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0.dp)
    ){ paddingValues ->
        content(paddingValues, transitionData, snackbarHostState)
    }
}

@Preview(name = "Scaffold • Menu Open", showBackground = true)
@Composable
private fun TrailScaffoldPreview() {
    TrailsTheme {
        val navController = rememberNavController()
        val route = remember { mutableStateOf<NavBackStackEntry?>(null) }
        TrailScaffold(
            topBar = { menuState ->
                TrailsTopAppBar(
                    title = "Trails",
                    navController = navController,
                    route = route,
                    menuState = menuState,
                )
            },
        ) { paddingValues, _, _ ->
            Column(Modifier.padding(paddingValues)) {
                Text(text = "Preview Content")
            }
        }
    }
}

@Preview(
    name = "Scaffold • Menu Closed (Dark)",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun TrailScaffoldDarkPreview() {
    TrailsTheme(darkTheme = true) {
        val navController = rememberNavController()
        val route = remember { mutableStateOf<NavBackStackEntry?>(null) }
        TrailScaffold(
            topBar = { menuState ->
                menuState.value = MenuState.Closed
                TrailsTopAppBar(
                    title = "Trails",
                    navController = navController,
                    route = route,
                    menuState = menuState,
                )
            },
        ) { paddingValues, _, _ ->
            Column(Modifier.padding(paddingValues)) {
                Text(text = "Drawer collapsed for preview")
            }
        }
    }
}

enum class MenuState {
    Open,
    Closed
}

class TransitionData(
    scale: State<Float>,
    offset: State<Float>,
    rotate: State<Float>
) {
    val scale by scale
    val offset by offset
    val rotate by rotate
}

@Composable
private fun updateTransitionData(
    menuState: MenuState
): TransitionData {
    val transition = updateTransition(targetState = menuState, label = "transition")
    val scale = transition.animateFloat(label = "scale") { state ->
        when (state) {
            MenuState.Open -> 1f
            MenuState.Closed -> 0.85f
        }
    }
    val offset = transition.animateFloat(label = "offset") { state ->
        when (state) {
            MenuState.Open -> 0f
            MenuState.Closed -> 1f
        }
    }
    val rotate = transition.animateFloat(label = "rotate") { state ->
        when (state) {
            MenuState.Open -> 0f
            MenuState.Closed -> 15f
        }
    }
    return remember(transition) {
        TransitionData(
            scale = scale,
            offset = offset,
            rotate = rotate
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrailsTopAppBar(
    title: String,
    navController: NavController,
    route: State<NavBackStackEntry?>,
    menuState: MutableState<MenuState>,
) {
    val destination = route.value?.destination?.route
    val icon = when (destination) {
        "main" -> painterResource(R.drawable.menu_24px)
        else -> painterResource(R.drawable.arrow_back_24px)
    }
    val titleText by remember(destination) {
        if (destination == "search") {
            mutableStateOf("Search")
        } else {
            mutableStateOf(title)
        }
    }

    val actionOnClick = when (destination) {
        "main" -> { { navController.navigate("search") } }
        "search" -> { {} }
        else -> { {} }
    }

    val iconImage = when (destination) {
        "main" -> painterResource(R.drawable.search_24px)
        "search" -> painterResource(R.drawable.more_vert_24px)
        else -> null
    }

    val contentDesc = when (destination) {
        "main" -> "Search"
        "search" -> "Menu"
        else -> null
    }
    AnimatedVisibility(visible = destination != "search"){
        CenterAlignedTopAppBar(
            title = {
                Text(
                    text = titleText,
                    style = MaterialTheme.typography.titleLarge
                )
            },
            navigationIcon = {
                IconButton(
                    onClick = {
                        if (destination != "main") {
                            navController.popBackStack()
                        } else if (menuState.value == MenuState.Open) {
                            menuState.value = MenuState.Closed
                        } else {
                            menuState.value = MenuState.Open
                        }
                    }
                ) {
                    Icon(
                        painter = icon,
                        contentDescription = "Back"
                    )
                }
            },
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface,
                titleContentColor = MaterialTheme.colorScheme.onSurface,
                navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
                actionIconContentColor = MaterialTheme.colorScheme.onSurface,
            ),
            actions = {
                if (iconImage != null) {
                    IconButton(onClick = actionOnClick) {
                        Icon(painter = iconImage, contentDescription = contentDesc)
                    }
                }
                IconButton(onClick = { navController.navigate("settings") }) {
                    Icon(painter = painterResource(R.drawable.settings_24px), contentDescription = "Settings")
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrailsTopAppBarNav3(
    title: String,
    currentScreen: Screen,
    menuState: MutableState<MenuState>,
    onNavigateBack: () -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToSettings: () -> Unit,
) {
    // Determine icons and actions based on current screen
    val icon = when (currentScreen) {
        is Screen.ArticleList -> painterResource(R.drawable.menu_24px)
        else -> painterResource(R.drawable.arrow_back_24px)
    }

    val titleText = when (currentScreen) {
        is Screen.ArticleSearch -> "Search"
        is Screen.Settings -> "Settings"
        is Screen.ArticleDetail -> "Article"
        is Screen.TagManagement -> "Tags"
        else -> title
    }

    val actionOnClick: () -> Unit = when (currentScreen) {
        is Screen.ArticleList -> onNavigateToSearch
        else -> { {} }
    }

    val actionIcon = when (currentScreen) {
        is Screen.ArticleList -> painterResource(R.drawable.search_24px)
        is Screen.ArticleSearch -> painterResource(R.drawable.more_vert_24px)
        else -> null
    }

    val actionContentDesc = when (currentScreen) {
        is Screen.ArticleList -> "Search"
        is Screen.ArticleSearch -> "Menu"
        else -> null
    }

    // Hide app bar on search screen
    AnimatedVisibility(visible = currentScreen !is Screen.ArticleSearch) {
        CenterAlignedTopAppBar(
            title = {
                Text(
                    text = titleText,
                    style = MaterialTheme.typography.titleLarge
                )
            },
            navigationIcon = {
                IconButton(
                    onClick = {
                        when (currentScreen) {
                            is Screen.ArticleList -> {
                                // Toggle menu
                                menuState.value = if (menuState.value == MenuState.Open) {
                                    MenuState.Closed
                                } else {
                                    MenuState.Open
                                }
                            }
                            else -> {
                                // Go back
                                onNavigateBack()
                            }
                        }
                    }
                ) {
                    Icon(
                        painter = icon,
                        contentDescription = if (currentScreen is Screen.ArticleList) "Menu" else "Back"
                    )
                }
            },
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface,
                titleContentColor = MaterialTheme.colorScheme.onSurface,
                navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
                actionIconContentColor = MaterialTheme.colorScheme.onSurface,
            ),
            actions = {
                if (actionIcon != null) {
                    IconButton(onClick = actionOnClick) {
                        Icon(painter = actionIcon, contentDescription = actionContentDesc)
                    }
                }
                IconButton(onClick = onNavigateToSettings) {
                    Icon(painter = painterResource(R.drawable.settings_24px), contentDescription = "Settings")
                }
            }
        )
    }
}

