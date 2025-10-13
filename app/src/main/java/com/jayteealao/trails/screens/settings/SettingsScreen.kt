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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.Typography
import compose.icons.CssGgIcons
import compose.icons.cssggicons.ArrowRight
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    settingsViewModel: SettingsViewModel
) {
    val scope = rememberCoroutineScope()
    val preferenceFlow = settingsViewModel.preferenceFlow.collectAsState()
    val jinaToken = settingsViewModel.jinaToken.collectAsState()
    SettingsScreenContent(
        modifier = modifier,
        useFreedium = preferenceFlow.value,
        jinaToken = jinaToken.value,
        jinaPlaceholder = settingsViewModel.jinaPlaceHolder,
        onResetSemanticCache = {
            scope.launch { settingsViewModel.resetSemanticCache() }
        },
        onToggleFreedium = { settingsViewModel.updatePreference(it) },
        onJinaTokenChange = { settingsViewModel.updateJinaToken(it) },
        onSubmitJinaToken = { settingsViewModel.updateJinaTokenPreferences() },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreenContent(
    modifier: Modifier = Modifier,
    useFreedium: Boolean,
    jinaToken: String,
    jinaPlaceholder: String,
    onResetSemanticCache: () -> Unit,
    onToggleFreedium: (Boolean) -> Unit,
    onJinaTokenChange: (String) -> Unit,
    onSubmitJinaToken: () -> Unit,
) {
    Column(modifier = modifier) {
        Text(text = "Settings")
        TextButton(
            modifier = Modifier.height(48.dp),
            onClick = onResetSemanticCache
        ) {
            Text(text = "Reset Semantic Cache")
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
                checked = useFreedium,
                onCheckedChange = onToggleFreedium
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
                value = jinaToken,
                modifier = Modifier.weight(0.6f),
                onValueChange = onJinaTokenChange,
                placeholder = { Text(text = jinaPlaceholder) },
                supportingText = {
                    Text(
                        text = "Jina.ai token is required to extract text from saved articles—get one at https://r.jina.ai/",
                        style = Typography.titleSmall
                    )
                }
            )
            IconButton(
                onClick = onSubmitJinaToken,
            ) {
                Icon(
                    imageVector = CssGgIcons.ArrowRight,
                    contentDescription = "submit"
                )
            }
        }
    }
}

@Preview(name = "Settings • Freedium Enabled", showBackground = true)
@Composable
private fun SettingsScreenPreview() {
    TrailsTheme {
        SettingsScreenContent(
            useFreedium = true,
            jinaToken = PreviewFixtures.authAccessToken,
            jinaPlaceholder = "Insert Jina Token Here",
            onResetSemanticCache = {},
            onToggleFreedium = {},
            onJinaTokenChange = {},
            onSubmitJinaToken = {},
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
        SettingsScreenContent(
            useFreedium = false,
            jinaToken = "",
            jinaPlaceholder = "Insert Jina Token Here",
            onResetSemanticCache = {},
            onToggleFreedium = {},
            onJinaTokenChange = {},
            onSubmitJinaToken = {},
        )
    }
}
