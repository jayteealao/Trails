package com.jayteealao.trails.screens.settings

import android.content.Context
import android.content.res.Configuration
import android.text.format.DateUtils
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.services.firestore.SyncStatus
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    onLogout: () -> Unit = {},
    onShowLogoutDialog: () -> Unit = {},
    upgrading: Boolean = false,
    onUpgradeAccount: () -> Unit = {},
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel> = rememberViewStore { hiltViewModel() }
) {
    SettingsScreenContent(
        modifier = modifier,
        viewStore = viewStore,
        onLogout = onLogout,
        onShowLogoutDialog = onShowLogoutDialog,
        upgrading = upgrading,
        onUpgradeAccount = onUpgradeAccount
    )

    // Handle events
    viewStore.handle<SettingsEvent.SemanticCacheCleared> {
        // Could show a toast or snackbar here
    }

    val context = LocalContext.current
    viewStore.handle<SettingsEvent.ShowToast> { event ->
        showSettingsMessage(context, event.message)
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
    upgrading: Boolean = false,
    onUpgradeAccount: () -> Unit = {}
) {
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
        SectionHead("Account")

        val account = viewStore.state.userEmail ?: if (viewStore.state.isAnonymous) "Guest" else null
        if (account != null) SettingRow(title = "Account", value = account)

        if (viewStore.state.isAnonymous) {
            // A guest can keep the library and add a Google account; off while one is added.
            SettingRow(
                title = "Full account",
                hint = "Keep your articles on every device",
                control = {
                    FilledTonalButton(onClick = onUpgradeAccount, enabled = !upgrading) {
                        Text(text = "Upgrade")
                    }
                },
            )
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
        SectionHead("Appearance")
        ThemeChoiceRow(
            choice = viewStore.state.theme,
            onChoose = { viewStore.action { updateTheme(it) } },
        )
        SettingRow(
            title = "Card layout",
            // The whole row is the switch, so its name and its target go with it.
            modifier = Modifier.toggleable(
                value = viewStore.state.useCardLayout,
                role = Role.Switch,
                onValueChange = { viewStore.action { updateCardLayout(it) } },
            ),
            hint = "Display articles as cards with spacing",
            control = { Switch(checked = viewStore.state.useCardLayout, onCheckedChange = null) },
        )
        SectionHead("Integrations")
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
        SectionHead("Sync")

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

        SyncFailureRow(
            count = viewStore.state.syncFailureCount,
            isRetrying = viewStore.state.isRetryingFailures,
            retryFailed = viewStore.state.retryFailed,
            onRetry = { viewStore.action { retrySyncFailures() } },
        )

        // After a successful Retry the row goes away; focus moves to Sync Now once it is
        // enabled. A background sync never moves focus. A disabled button cannot take
        // focus (the retry's own sync may still run), so the move waits for Sync Now.
        val syncNowFocus = remember { FocusRequester() }
        // No sync while the local data is being cleared.
        val syncNowEnabled = !viewStore.state.isSyncing &&
            viewStore.state.unsyncedChangesDialog == UnsyncedChangesDialogState.Hidden
        var focusSyncNowWhenEnabled by remember { mutableStateOf(false) }
        viewStore.handle<SettingsEvent.RetrySucceeded> {
            focusSyncNowWhenEnabled = true
        }
        LaunchedEffect(focusSyncNowWhenEnabled, syncNowEnabled) {
            if (focusSyncNowWhenEnabled && syncNowEnabled) {
                runCatching { syncNowFocus.requestFocus() }
                focusSyncNowWhenEnabled = false
            }
        }

        // Manual Sync Button with Loading Indicator
        Button(
            onClick = { viewStore.action { performManualSync() } },
            enabled = syncNowEnabled,
            modifier = Modifier
                .focusRequester(syncNowFocus)
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

        SectionHead("About")
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

    UnsyncedChangesDialog(
        state = viewStore.state.unsyncedChangesDialog,
        onKeep = { viewStore.action { keepLocalData() } },
        onConfirm = { viewStore.action { clearAnyway() } },
        onCancelPush = { viewStore.action { cancelUnsyncedPush() } },
    )
}

/** The divider and the name that start a section of Settings. */
@Composable
private fun SectionHead(title: String) {
    HorizontalDivider()
    Text(
        text = title,
        modifier = Modifier
            .padding(top = 12.dp, bottom = 4.dp)
            .semantics { heading() },
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Preview(name = "Settings • Freedium Enabled", showBackground = true)
@Composable
private fun SettingsScreenPreview() {
    TrailsTheme {
        SettingsScreen(
            viewStore = ViewStore {
                SettingsState(
                    useFreedium = true,
                    theme = ThemeChoice.SYSTEM,
                    useCardLayout = true,
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
                    theme = ThemeChoice.DARK,
                    useCardLayout = true,
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

/** Show a one-line message from Settings, such as a failed retry, as a toast. */
internal fun showSettingsMessage(context: Context, message: String) {
    Toast.makeText(context, message, Toast.LENGTH_LONG).show()
}
