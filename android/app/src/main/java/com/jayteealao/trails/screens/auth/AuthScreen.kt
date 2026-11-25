package com.jayteealao.trails.screens.auth

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.components.findActivity
import com.jayteealao.trails.screens.components.rememberAddGoogleAccount
import com.jayteealao.trails.screens.components.showError
import com.jayteealao.trails.screens.settings.UnsyncedChangesDialog
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

/** Shows the messages of the account that are not a screen state, on whichever screen is open. */
@Composable
fun AuthMessages(authViewModel: AuthViewModel, snackbarHostState: SnackbarHostState) {
    val viewStore = rememberViewStore { authViewModel }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val addGoogleAccount = rememberAddGoogleAccount(onClosed = {})

    viewStore.handle<AuthEvent.Upgraded> {
        scope.launch { snackbarHostState.showSnackbar(UPGRADED) }
    }
    viewStore.handle<AuthEvent.UpgradeFailed> { event ->
        scope.launch {
            snackbarHostState.showUpgradeFailure(
                message = event.message,
                retry = { context.findActivity()?.let { authViewModel.upgradeAccount(it) } },
                addAccount = addGoogleAccount,
            )
        }
    }
}

/** What a successful account upgrade says. */
internal const val UPGRADED = "Your account is upgraded"

/** The label of the action that adds a Google account to the phone. */
internal const val ADD_ACCOUNT = "Add account"

/**
 * Shows a failed account upgrade: no account offers to add one, an account with its own library
 * offers nothing, and every other failure offers Try again.
 */
internal suspend fun SnackbarHostState.showUpgradeFailure(
    message: ErrorMessage,
    retry: () -> Unit,
    addAccount: () -> Unit,
) {
    when (message) {
        ErrorMessage.GOOGLE_NO_ACCOUNT -> {
            val result = showSnackbar(message.text, actionLabel = ADD_ACCOUNT, duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed) addAccount()
        }
        ErrorMessage.ACCOUNT_IN_USE -> showSnackbar(message.text, duration = SnackbarDuration.Long)
        else -> showError(message, retry)
    }
}
