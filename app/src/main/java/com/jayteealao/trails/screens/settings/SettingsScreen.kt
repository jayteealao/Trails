package com.jayteealao.trails.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    settingsViewModel: SettingsViewModel
) {
    val scope = rememberCoroutineScope()
    Column(modifier = modifier) {
        Text(text = "Settings")
        TextButton(
            onClick = {
                scope.launch {
                    settingsViewModel.resetSemanticCache()
                }
            }
        ) {
            Text(text = "Reset Semantic Cache")
        }
    }
}