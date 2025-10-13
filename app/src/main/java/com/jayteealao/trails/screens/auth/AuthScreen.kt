package com.jayteealao.trails.screens.auth

import android.content.res.Configuration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme


@Composable
fun AuthScreen(navController: NavController, modifier: Modifier = Modifier, viewModel: AuthViewModel = hiltViewModel()) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current

    val uiState by viewModel.uiState.collectAsStateWithLifecycle(lifecycle = lifecycle)

    AuthScreenContent(
        modifier = modifier,
        uiState = uiState,
        onGetRequestToken = { viewModel.getRequestToken() },
        onAuthorize = { token -> context.startActivity(viewModel.authorizeIntent(token)) },
        onGetAccessToken = { viewModel.getNetworkAccessToken(viewModel.requestToken) },
        onNavigateToMain = { navController.navigate("main") },
    )
}

@Composable
internal fun AuthScreenContent(
    modifier: Modifier = Modifier,
    uiState: AuthUiState,
    onGetRequestToken: () -> Unit,
    onAuthorize: (String) -> Unit,
    onGetAccessToken: () -> Unit,
    onNavigateToMain: () -> Unit,
) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        when (uiState) {
            is AuthUiState.NeedAuth -> {
                Column {
                    Text(text = "Obtain Request Token")
                    Button(onClick = onGetRequestToken) {
                        Text(text = "Get Request Token")
                    }
                }
            }
            is AuthUiState.RequestToken -> {
                Column {
                    Text(text = "Authorize Request Token")
                    Text(text = uiState.data)
                    Button(
                        onClick = { onAuthorize(uiState.data) }
                    ) {
                        Text(text = "Authorize")
                    }
                }
            }
            is AuthUiState.AccessToken -> {
                Column {
                    Text(text = "Access Token: ${uiState.data}")
                    Button(onClick = onNavigateToMain) {
                        Text(text = "Get Articles")
                    }
                }
            }
            is AuthUiState.Loading -> {
                Column {
                    Text(text = "Have you authorized the app")
                    Button(onClick = onGetAccessToken) {
                        Text(text = "Get Access Token")
                    }
                }
            }
            is AuthUiState.Error -> {
                Column {
                    Text(text = "Something went wrong")
                    Text(text = uiState.throwable.message ?: "Unknown error")
                    Button(onClick = onGetRequestToken) {
                        Text(text = "Retry")
                    }
                }
            }
        }
    }
}

@Preview(name = "Auth • Request", showBackground = true)
@Composable
private fun AuthNeedTokenPreview() {
    TrailsTheme {
        AuthScreenContent(
            uiState = AuthUiState.NeedAuth,
            onGetRequestToken = {},
            onAuthorize = {},
            onGetAccessToken = {},
            onNavigateToMain = {},
        )
    }
}

@Preview(name = "Auth • Authorize", showBackground = true)
@Composable
private fun AuthAuthorizePreview() {
    TrailsTheme {
        AuthScreenContent(
            uiState = AuthUiState.RequestToken(PreviewFixtures.authRequestToken),
            onGetRequestToken = {},
            onAuthorize = {},
            onGetAccessToken = {},
            onNavigateToMain = {},
        )
    }
}

@Preview(name = "Auth • Access", showBackground = true)
@Composable
private fun AuthAccessPreview() {
    TrailsTheme {
        AuthScreenContent(
            uiState = AuthUiState.AccessToken(PreviewFixtures.authAccessToken),
            onGetRequestToken = {},
            onAuthorize = {},
            onGetAccessToken = {},
            onNavigateToMain = {},
        )
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
        AuthScreenContent(
            uiState = AuthUiState.Loading,
            onGetRequestToken = {},
            onAuthorize = {},
            onGetAccessToken = {},
            onNavigateToMain = {},
        )
    }
}

@Preview(name = "Auth • Error", showBackground = true)
@Composable
private fun AuthErrorPreview() {
    TrailsTheme {
        AuthScreenContent(
            uiState = AuthUiState.Error(Throwable("Network unavailable")),
            onGetRequestToken = {},
            onAuthorize = {},
            onGetAccessToken = {},
            onNavigateToMain = {},
        )
    }
}
