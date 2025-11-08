package com.jayteealao.trails.screens.auth

import android.content.res.Configuration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore


@Composable
fun AuthScreen(
    navController: NavController,
    modifier: Modifier = Modifier,
    viewStore: ViewStore<AuthUiState, AuthEvent, AuthViewModel> = rememberViewStore { hiltViewModel() }
) {
    val context = LocalContext.current

    // Handle events
    viewStore.handle<AuthEvent.NavigateToMain> {
        navController.navigate("main")
    }

    viewStore.handle<AuthEvent.OpenBrowserForAuth> { event ->
        context.startActivity(event.intent)
    }

    viewStore.handle<AuthEvent.ShowError> { event ->
        // Could show toast/snackbar with error message
    }

    viewStore.handle<AuthEvent.ShowToast> { event ->
        // Could show toast message
    }

    // Render different UI based on state
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        when (val currentState = viewStore.state) {
            is AuthUiState.NeedAuth -> {
                Column {
                    Text(text = "Obtain Request Token")
                    Button(onClick = { viewStore.action { getRequestToken() } }) {
                        Text(text = "Get Request Token")
                    }
                }
            }
            is AuthUiState.RequestToken -> {
                Column {
                    Text(text = "Authorize Request Token")
                    Text(text = currentState.data)
                    Button(onClick = { viewStore.action { authorizeWithBrowser(currentState.data) } }) {
                        Text(text = "Authorize")
                    }
                }
            }
            is AuthUiState.AccessToken -> {
                Column {
                    Text(text = "Access Token: ${currentState.data}")
                    Button(onClick = { navController.navigate("main") }) {
                        Text(text = "Get Articles")
                    }
                }
            }
            is AuthUiState.Loading -> {
                Column {
                    Text(text = "Have you authorized the app")
                    Button(onClick = { viewStore.action { getNetworkAccessToken() } }) {
                        Text(text = "Get Access Token")
                    }
                }
            }
            is AuthUiState.Error -> {
                Column {
                    Text(text = "Something went wrong")
                    Text(text = currentState.throwable.message ?: "Unknown error")
                    Button(onClick = { viewStore.action { getRequestToken() } }) {
                        Text(text = "Retry")
                    }
                }
            }
        }
    }
}

// Previews using ViewStore
@Preview(name = "Auth • Request", showBackground = true)
@Composable
private fun AuthNeedTokenPreview() {
    TrailsTheme {
        Box(contentAlignment = Alignment.Center) {
            ViewStore<AuthUiState, AuthEvent, AuthViewModel> { AuthUiState.NeedAuth }.render<AuthUiState.NeedAuth> {
                Column {
                    Text(text = "Obtain Request Token")
                    Button(onClick = {}) {
                        Text(text = "Get Request Token")
                    }
                }
            }
        }
    }
}

@Preview(name = "Auth • Authorize", showBackground = true)
@Composable
private fun AuthAuthorizePreview() {
    TrailsTheme {
        Box(contentAlignment = Alignment.Center) {
            ViewStore<AuthUiState, AuthEvent, AuthViewModel> { AuthUiState.RequestToken(PreviewFixtures.authRequestToken) }.render<AuthUiState.RequestToken> {
                Column {
                    Text(text = "Authorize Request Token")
                    Text(text = state.data)
                    Button(onClick = {}) {
                        Text(text = "Authorize")
                    }
                }
            }
        }
    }
}

@Preview(name = "Auth • Access", showBackground = true)
@Composable
private fun AuthAccessPreview() {
    TrailsTheme {
        Box(contentAlignment = Alignment.Center) {
            ViewStore<AuthUiState, AuthEvent, AuthViewModel> { AuthUiState.AccessToken(PreviewFixtures.authAccessToken) }.render<AuthUiState.AccessToken> {
                Column {
                    Text(text = "Access Token: ${state.data}")
                    Button(onClick = {}) {
                        Text(text = "Get Articles")
                    }
                }
            }
        }
    }
}

@Preview(
    name = "Auth • Loading (Dark)",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun AuthLoadingPreview() {
    TrailsTheme(darkTheme = true) {
        Box(contentAlignment = Alignment.Center) {
            ViewStore<AuthUiState, AuthEvent, AuthViewModel> { AuthUiState.Loading }.render<AuthUiState.Loading> {
                Column {
                    Text(text = "Have you authorized the app")
                    Button(onClick = {}) {
                        Text(text = "Get Access Token")
                    }
                }
            }
        }
    }
}

@Preview(name = "Auth • Error", showBackground = true)
@Composable
private fun AuthErrorPreview() {
    TrailsTheme {
        Box(contentAlignment = Alignment.Center) {
            ViewStore<AuthUiState, AuthEvent, AuthViewModel> { AuthUiState.Error(Throwable("Network unavailable")) }.render<AuthUiState.Error> {
                Column {
                    Text(text = "Something went wrong")
                    Text(text = state.throwable.message ?: "Unknown error")
                    Button(onClick = {}) {
                        Text(text = "Retry")
                    }
                }
            }
        }
    }
}
