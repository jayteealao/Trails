package com.jayteealao.trails.screens.auth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController


@Composable
fun AuthScreen(navController: NavController, modifier: Modifier = Modifier, viewModel: AuthViewModel = hiltViewModel()) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
//    val uiState by produceState<AuthUiState>(
//        initialValue = AuthUiState.NeedAuth,
//        key1 = lifecycle,
//        key2 = viewModel) {
//        lifecycle.repeatOnLifecycle(state = Lifecycle.State.STARTED) {
//            viewModel.uiState.collect {this@produceState.value = it }
//        }
//    }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle(lifecycle = lifecycle)

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        when (uiState) {
            is AuthUiState.NeedAuth -> {
                Column {
                    Text(text = "Obtain Request Token")
                    Button(onClick = { viewModel.getRequestToken() }) {
                        Text(text = "Get Request Token")
                    }
                }
            }
            is AuthUiState.RequestToken -> {
                Column {
                    Text(text = "Authorize Request Token")
                    Text(text = ((uiState as AuthUiState.RequestToken).data))
                    Button(
                        onClick = {
                            context.startActivity(viewModel.authorizeIntent((uiState as AuthUiState.RequestToken).data))
                        }
                    ) {
                        Text(text = "Authorize")
                    }
                }
            }
            is AuthUiState.AccessToken -> {
                Column {
                    Text(text = "Access Token: " + (uiState as AuthUiState.AccessToken).data)
                    Button(onClick = { navController.navigate("main") }) {
                        Text(text = "Get Articles")
                    }
                }
            }
            is AuthUiState.Loading -> {
                Column {
                    Text(text = "Have you authorized the app")
                    Button(
                        onClick = {
                            viewModel.getNetworkAccessToken((viewModel.requestToken))
                        }
                    ) {
                        Text(text = "Get Access Token")
                    }
                }
            }

            else -> {}
        }

    }
}