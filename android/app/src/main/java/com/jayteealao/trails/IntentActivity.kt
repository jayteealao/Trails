package com.jayteealao.trails

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.jayteealao.trails.data.ThemePreference
import com.jayteealao.trails.screens.share.ShareSheet
import com.jayteealao.trails.screens.share.ShareViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.rememberDarkTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** Saves a link from another app, in a sheet over that app. */
@AndroidEntryPoint
class IntentActivity : ComponentActivity() {
    @Inject
    lateinit var themePreference: ThemePreference

    private val viewModel by viewModels<ShareViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT)

        viewModel.start(
            text = intent.dataString ?: intent.textExtra(Intent.EXTRA_TEXT),
            title = intent.textExtra(Intent.EXTRA_TITLE) ?: intent.textExtra(Intent.EXTRA_SUBJECT),
        )

        setContent {
            TrailsTheme(darkTheme = rememberDarkTheme(themePreference)) {
                val state by viewModel.state.collectAsState()
                ShareSheet(
                    state = state,
                    onUndo = viewModel::undo,
                    onRetry = viewModel::retry,
                    onClosed = ::finish,
                )
            }
        }
    }

    /** The text of [key], styled or not; null when it has no words. */
    private fun Intent.textExtra(key: String): String? =
        getCharSequenceExtra(key)?.toString()?.takeIf { it.isNotBlank() }
}
