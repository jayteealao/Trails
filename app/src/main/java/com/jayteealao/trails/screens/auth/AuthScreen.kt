package com.jayteealao.trails.screens.auth

import android.app.Activity.RESULT_OK
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.firebase.auth.GoogleAuthProvider
import com.jayteealao.trails.R
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@Composable
fun AuthScreen(
    modifier: Modifier = Modifier,
    onLoginSuccess: () -> Unit,
    viewStore: ViewStore<AuthUiState, AuthEvent, AuthViewModel> = rememberViewStore { hiltViewModel() }
) {
    val context = LocalContext.current

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            val account = task.result
            val credential = GoogleAuthProvider.getCredential(account.idToken, null)
            viewStore.action { signInWithCredential(credential) }
        }
    }

    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestIdToken(context.getString(R.string.default_web_client_id))
        .requestEmail()
        .build()

    val googleSignInClient = GoogleSignIn.getClient(context, gso)

    // Handle events
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
        when (val state = viewStore.state) {
            is AuthUiState.SignedOut -> {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(dp = 12.dp)
                ) {
                    Button(onClick = {
                        googleSignInLauncher.launch(googleSignInClient.signInIntent)
                    }) {
                        Text(text = "Sign In with Google")
                    }
                    OutlinedButton(onClick = {
                        viewStore.action { signInAnonymously() }
                    }) {
                        Text(text = "Continue as Guest")
                    }
                }
            }
            is AuthUiState.SignedIn -> {
                onLoginSuccess()
            }
            is AuthUiState.Loading -> {
                Text(text = "Loading...")
            }
            is AuthUiState.Error -> {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(dp = 12.dp)
                ) {
                    Text(text = "Something went wrong")
                    Text(text = state.throwable.message ?: "Unknown error")
                    Button(onClick = {
                        googleSignInLauncher.launch(googleSignInClient.signInIntent)
                    }) {
                        Text(text = "Retry")
                    }
                    OutlinedButton(onClick = {
                        viewStore.action { signInAnonymously() }
                    }) {
                        Text(text = "Continue as Guest")
                    }
                }
            }
        }
    }
}
