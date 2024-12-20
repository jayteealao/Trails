package com.jayteealao.trails.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.updateTransition
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrailScaffold(
    topBar : @Composable (MutableState<MenuState>) -> Unit = {},
    content: @Composable (PaddingValues, TransitionData) -> Unit,
) {
    val menuState = remember { mutableStateOf( MenuState.Open )}
    val transitionData = updateTransitionData(menuState = menuState.value)

    Scaffold(
        topBar = { topBar(menuState) },
        containerColor = Color.White,
    ){ paddingValues ->
        content(paddingValues, transitionData)
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
        "main" -> Icons.Filled.Menu
        else -> Icons.AutoMirrored.Filled.ArrowBack
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
        "main" -> Icons.Filled.Search
        "search" -> Icons.Filled.MoreVert
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
                        imageVector = icon,
                        contentDescription = "Back"
                    )
                }
            },
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                containerColor = Color.White,
            ),
            actions = {
                if (iconImage != null) {
                    IconButton(onClick = actionOnClick) {
                        Icon(imageVector = iconImage, contentDescription = contentDesc)
                    }
                }
                IconButton(onClick = { navController.navigate("settings") }) {
                    Icon(imageVector = Icons.Filled.Settings, contentDescription = "Settings")
                }
            }
        )
    }
}

