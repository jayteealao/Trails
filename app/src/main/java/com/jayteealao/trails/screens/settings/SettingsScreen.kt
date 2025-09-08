package com.jayteealao.trails.screens.settings

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
import androidx.compose.ui.unit.dp
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

    Column(modifier = modifier) {
        Text(text = "Settings")
        TextButton(
            modifier = Modifier.height(48.dp),
            onClick = {
                scope.launch {
                    settingsViewModel.resetSemanticCache()
                }
            }
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
                checked = preferenceFlow.value,
                onCheckedChange = { settingsViewModel.updatePreference(it) }
            )
            Text(text = "Use Freedium")
        }
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text("Jina Reader Token")
        Row(
            modifier = Modifier.wrapContentHeight().fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ){
            TextField(
                value = jinaToken.value,
                modifier = Modifier.weight(0.6f),
                onValueChange = { settingsViewModel.updateJinaToken(it) },
                placeholder = { Text(text = settingsViewModel.jinaPlaceHolder) },
                supportingText = {
                    Text(
                        text = "Jina.ai token is required to extract text from saved articles" +
                                " get one at https://r.jina.ai/",
                        style = Typography.titleSmall
                    )
                }
            )
            IconButton(
                onClick = { settingsViewModel.updateJinaTokenPreferences() },
//                modifier = Modifier.wrapContentHeight()
            ) {
                Icon(
                    imageVector = CssGgIcons.ArrowRight,
                    contentDescription = "submit"
                )
            }
        }
    }

}
