package com.jayteealao.trails.screens.auth

import android.app.Activity.RESULT_OK
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.GoogleAuthProvider
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.components.findActivity
import com.jayteealao.trails.screens.components.rememberAddGoogleAccount
import com.jayteealao.trails.screens.settings.UnsyncedChangesDialog
import compose.icons.CssGgIcons
import compose.icons.cssggicons.Danger
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    modifier: Modifier = Modifier,
    onLoginSuccess: () -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    viewStore: ViewStore<AuthUiState, AuthEvent, AuthViewModel> = rememberViewStore { authViewModel }
) {
    val context = LocalContext.current
    val unsyncedChangesDialog by authViewModel.unsyncedChangesDialog.collectAsState()
    val addGoogleAccount = rememberAddGoogleAccount(
        onClosed = { viewStore.action { accountSettingsClosed() } },
    )
    val state = viewStore.state

    if (state is AuthUiState.SignedIn) {
        LaunchedEffect(state) { onLoginSuccess() }
    }

    SignInPanel(
        state = state,
        onGoogle = {
            context.findActivity()?.let { activity -> viewStore.action { signInWithGoogle(activity) } }
        },
        onGuest = { viewStore.action { signInAnonymously() } },
        // Skip opens what is on this phone with no account.
        onSkip = onLoginSuccess,
        onCancel = { viewStore.action { cancelSignIn() } },
        onAddAccount = addGoogleAccount,
        modifier = modifier,
    )

    // Shown while another account's library is cleared, before this sign-in completes.
    UnsyncedChangesDialog(
        state = unsyncedChangesDialog,
        onKeep = { viewStore.action { keepPreviousAccountData() } },
        onConfirm = { viewStore.action { switchAccountAnyway() } },
        onCancelPush = { viewStore.action { keepPreviousAccountData() } },
    )
}

/** A failed sign-in in fixed words, read out once, and the ways to try again. */
@Composable
internal fun AuthErrorContent(
    message: ErrorMessage,
    onRetryGoogle: () -> Unit,
    onContinueAsGuest: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_launcher_foreground),
            contentDescription = "Trails Logo",
            modifier = Modifier.size(120.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Text(
            text = "Trails",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Error container with better visual design
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.errorContainer,
            shape = MaterialTheme.shapes.medium
        ) {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    CssGgIcons.Danger,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(48.dp)
                )

                Text(
                    text = "Authentication Failed",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.error
                )

                Text(
                    text = message.text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    textAlign = TextAlign.Center
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Button(
            onClick = onRetryGoogle,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Text(text = "Retry with Google")
        }
        OutlinedButton(
            onClick = onContinueAsGuest,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        ) {
            Text(text = "Continue as Guest Instead")
        }
    }
}

/** Shows the messages of the account that are not a screen state, on whichever screen is open. */
@Composable
fun AuthMessages(authViewModel: AuthViewModel, snackbarHostState: SnackbarHostState) {
    val viewStore = rememberViewStore { authViewModel }
    val scope = rememberCoroutineScope()

    viewStore.handle<AuthEvent.ShowToast> { event ->
        scope.launch { snackbarHostState.showSnackbar(event.message) }
    }
}

@Composable
private fun SignedOutContent(
    onGoogleSignInClick: () -> Unit,
    onGuestSignInClick: () -> Unit,
    onSkipLoginClick: () -> Unit
) {
    val uriHandler = LocalUriHandler.current

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // App Logo
        Icon(
            painter = painterResource(id = R.drawable.ic_launcher_foreground),
            contentDescription = "Trails Logo",
            modifier = Modifier.size(120.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        // App Title
        Text(
            text = "Trails",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )

        Text(
            text = "Your personal article companion",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Google Sign In Button with Icon
        Button(
            onClick = onGoogleSignInClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Using Material Icons for Google logo would require adding dependency
                // For now, just text - can be enhanced later with actual Google icon
                Text(
                    text = "G",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(end = 8.dp)
                )
                Text(text = "Sign In with Google")
            }
        }

        OutlinedButton(
            onClick = onGuestSignInClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
        ) {
            Text(text = "Continue as Guest")
        }

        TextButton(
            onClick = onSkipLoginClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
        ) {
            Text(text = "Skip Login (Browse Local Articles)")
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Clickable Privacy Policy and Terms
        val annotatedText = buildAnnotatedString {
            append("By continuing, you agree to our ")

            pushStringAnnotation(
                tag = "TERMS",
                annotation = "https://trails.example.com/terms"
            )
            withStyle(
                style = SpanStyle(
                    color = MaterialTheme.colorScheme.primary,
                    textDecoration = TextDecoration.Underline
                )
            ) {
                append("Terms of Service")
            }
            pop()

            append(" and ")

            pushStringAnnotation(
                tag = "PRIVACY",
                annotation = "https://trails.example.com/privacy"
            )
            withStyle(
                style = SpanStyle(
                    color = MaterialTheme.colorScheme.primary,
                    textDecoration = TextDecoration.Underline
                )
            ) {
                append("Privacy Policy")
            }
            pop()
        }

        ClickableText(
            text = annotatedText,
            style = MaterialTheme.typography.bodySmall.copy(
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            ),
            modifier = Modifier.padding(horizontal = 16.dp),
            onClick = { offset ->
                annotatedText.getStringAnnotations(
                    tag = "TERMS",
                    start = offset,
                    end = offset
                ).firstOrNull()?.let { annotation ->
                    uriHandler.openUri(annotation.item)
                }

                annotatedText.getStringAnnotations(
                    tag = "PRIVACY",
                    start = offset,
                    end = offset
                ).firstOrNull()?.let { annotation ->
                    uriHandler.openUri(annotation.item)
                }
            }
        )
    }
}
