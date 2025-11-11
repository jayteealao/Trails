package com.jayteealao.trails.screens.settings

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.Typography
import compose.icons.CssGgIcons
import compose.icons.cssggicons.ArrowRight
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel> = rememberViewStore { hiltViewModel() }
) {
    SettingsScreenContent(
        modifier = modifier,
        viewStore = viewStore
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
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreenContent(
    modifier: Modifier = Modifier,
    viewStore: ViewStore<SettingsState, SettingsEvent, SettingsViewModel>
) {
    Column(modifier = modifier) {
        Text(text = "Settings")
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
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = "Dark mode")
            Switch(
                checked = viewStore.state.darkTheme,
                onCheckedChange = { viewStore.action { updateDarkTheme(it) } }
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = "Card layout")
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
                    versionCode = 108090
                )
            }
        )
    }
}

@Preview(
    name = "Settings • Empty Token (Dark)",
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
                    versionCode = 108090
                )
            }
        )
    }
}
