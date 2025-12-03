package com.jayteealao.trails.screens.settings

import android.app.Activity.RESULT_OK
import android.content.res.Configuration
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.firebase.auth.GoogleAuthProvider
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.Typography
import com.jayteealao.trails.services.firestore.SyncStatus
import compose.icons.CssGgIcons
import compose.icons.cssggicons.ArrowRight
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    onLogout: () -> Unit = {},
    onShowLogoutDialog: () -> Unit = {},
    onUpgradeAccount: (com.google.firebase.auth.AuthCredential) -> Unit = {},
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel> = rememberViewStore { hiltViewModel() }
) {
    SettingsScreenContent(
        modifier = modifier,
        viewStore = viewStore,
        onLogout = onLogout,
        onShowLogoutDialog = onShowLogoutDialog,
        onUpgradeAccount = onUpgradeAccount
    )

    // Handle events
    viewStore.handle<SettingsEvent.SemanticCacheCleared> {
        // Could show a toast or snackbar here
    }

    viewStore.handle<SettingsEvent.JinaTokenSaved> {
        // Could show a toast or snackbar here
    }

    viewStore.handle<SettingsEvent.ShowToast> { event ->
        // Could show a toast or snackbar here
    }

    viewStore.handle<SettingsEvent.LoggedOut> {
        onLogout()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreenContent(
    modifier: Modifier = Modifier,
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel>,
    onLogout: () -> Unit = {},
    onShowLogoutDialog: () -> Unit = {},
    onUpgradeAccount: (com.google.firebase.auth.AuthCredential) -> Unit = {}
) {
    val context = LocalContext.current

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            val account = task.result
            val credential = GoogleAuthProvider.getCredential(account.idToken, null)
            onUpgradeAccount(credential)
        }
    }

    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestIdToken(context.getString(R.string.default_web_client_id))
        .requestEmail()
        .build()

    val googleSignInClient = GoogleSignIn.getClient(context, gso)
    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .verticalScroll(scrollState)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = 16.dp)
    ) {
        // Screen Title
        Text(
            text = "Settings",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
            modifier = Modifier.padding(vertical = 16.dp)
        )

        // Account Section
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("ACCOUNT", style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))

        if (viewStore.state.userEmail != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Email")
                Text(
                    text = viewStore.state.userEmail ?: "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        if (viewStore.state.isAnonymous) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Account Type")
                Text(
                    text = "Guest",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            FilledTonalButton(
                onClick = {
                    googleSignInLauncher.launch(googleSignInClient.signInIntent)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
            ) {
                Text(text = "Upgrade to Full Account")
            }
        }

        OutlinedButton(
            onClick = onShowLogoutDialog,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
        ) {
            Text(text = "Logout")
        }
        TextButton(
            modifier = Modifier.height(48.dp),
            onClick = { viewStore.action { resetSemanticCache() } }
        ) {
            Text(text = "Reset Semantic Cache")
        }
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("APPEARANCE", style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Dark mode",
                    style = MaterialTheme.typography.bodyLarge
                )
                Text(
                    text = "Use dark theme across the app",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(
                checked = viewStore.state.darkTheme,
                onCheckedChange = { viewStore.action { updateDarkTheme(it) } }
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Card layout",
                    style = MaterialTheme.typography.bodyLarge
                )
                Text(
                    text = "Display articles as cards with spacing",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(
                checked = viewStore.state.useCardLayout,
                onCheckedChange = { viewStore.action { updateCardLayout(it) } }
            )
        }
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("INTEGRATIONS")
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.height(48.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = viewStore.state.useFreedium,
                onCheckedChange = { viewStore.action { updatePreference(it) } }
            )
            Text(text = "Use Freedium")
        }
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("Jina Reader Token")
        Row(
            modifier = Modifier
                .wrapContentHeight()
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            TextField(
                value = viewStore.state.jinaToken,
                modifier = Modifier.weight(0.6f),
                onValueChange = { viewStore.action { updateJinaToken(it) } },
                placeholder = { Text(text = viewStore.state.jinaPlaceholder) },
                supportingText = {
                    Text(
                        text = "Jina.ai token is required to extract text from saved articles—get one at https://r.jina.ai/",
                        style = Typography.titleSmall
                    )
                }
            )
            IconButton(
                onClick = { viewStore.action { updateJinaTokenPreferences() } },
            ) {
                Icon(
                    imageVector = CssGgIcons.ArrowRight,
                    contentDescription = "submit"
                )
            }
        }
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("SYNC", style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))

        // Sync Status Row with Animation
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Status",
                style = MaterialTheme.typography.bodyLarge
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                AnimatedVisibility(
                    visible = viewStore.state.isSyncing,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    text = when (val status = viewStore.state.syncStatus) {
                        is SyncStatus.Idle -> "Idle"
                        is SyncStatus.Syncing -> "Syncing..."
                        is SyncStatus.Success -> status.message
                        is SyncStatus.Error -> status.message
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = when (viewStore.state.syncStatus) {
                        is SyncStatus.Error -> MaterialTheme.colorScheme.error
                        is SyncStatus.Success -> MaterialTheme.colorScheme.primary
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }
        }

        // Last Sync Time Row
        if (viewStore.state.lastSyncTime > 0) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Last Sync")
                Text(
                    text = formatRelativeTime(viewStore.state.lastSyncTime),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // Manual Sync Button with Loading Indicator
        Button(
            onClick = { viewStore.action { performManualSync() } },
            enabled = !viewStore.state.isSyncing,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
                .height(48.dp)
        ) {
            AnimatedVisibility(
                visible = viewStore.state.isSyncing,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                Row {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                    Spacer(Modifier.width(8.dp))
                }
            }
            Text(text = if (viewStore.state.isSyncing) "Syncing..." else "Sync Now")
        }

        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("ABOUT", style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = "Version")
            Text(
                text = viewStore.state.versionName,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = "Build")
            Text(
                text = viewStore.state.versionCode.toString(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Preview(name = "Settings • Freedium Enabled", showBackground = true)
@Composable
private fun SettingsScreenPreview() {
    TrailsTheme {
        SettingsScreen(
            viewStore = ViewStore {
                SettingsState(
                    useFreedium = true,
                    darkTheme = false,
                    useCardLayout = true,
                    jinaToken = "sample_token_123",
                    jinaPlaceholder = "Insert Jina Token Here",
                    versionName = "1.8.9",
                    versionCode = 108090,
                    userEmail = "user@example.com",
                    isAnonymous = false
                )
            }
        )
    }
}

@Preview(
    name = "Settings • Guest Account (Dark)",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun SettingsScreenDarkPreview() {
    TrailsTheme(darkTheme = true) {
        SettingsScreen(
            viewStore = ViewStore {
                SettingsState(
                    useFreedium = false,
                    darkTheme = true,
                    useCardLayout = true,
                    jinaToken = "",
                    jinaPlaceholder = "Insert Jina Token Here",
                    versionName = "1.8.9",
                    versionCode = 108090,
                    userEmail = null,
                    isAnonymous = true
                )
            }
        )
    }
}

/**
 * Format timestamp as relative time (e.g., "2 minutes ago")
 */
private fun formatRelativeTime(timestamp: Long): String {
    return DateUtils.getRelativeTimeSpanString(
        timestamp,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE
    ).toString()
}
