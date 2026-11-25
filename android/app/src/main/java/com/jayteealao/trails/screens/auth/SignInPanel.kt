package com.jayteealao.trails.screens.auth

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.components.NoticeIcons
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.noricanFont

/**
 * The sign-in screen: the mark, the name, one line that tells the state, and the ways in.
 *
 * The line and the buttons are the same nodes in every state, so the line, a polite live
 * region, is read out when the state changes. An error line carries an icon, so the error is
 * not told by colour alone. The panel scrolls, so a large font hides no button.
 */
@Composable
fun SignInPanel(
    state: AuthUiState,
    onGoogle: () -> Unit,
    onGuest: () -> Unit,
    onSkip: () -> Unit,
    onCancel: () -> Unit,
    onAddAccount: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val busy = state is AuthUiState.Loading || state is AuthUiState.SignedIn
    val line = lineOf(state)

    BoxWithConstraints(modifier.fillMaxSize().safeDrawingPadding()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = PANEL_MAX_WIDTH)
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    imageVector = NoticeIcons.Book,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = colors.primary,
                )
                Text(
                    text = "Trails",
                    style = NameStyle,
                    color = colors.onBackground,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                    horizontalArrangement = if (line.isError) {
                        Arrangement.spacedBy(8.dp)
                    } else {
                        Arrangement.Center
                    },
                ) {
                    if (line.isError) {
                        Icon(
                            imageVector = ReaderNoticeIcons.Failed,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = colors.error,
                        )
                    }
                    Text(
                        text = line.text,
                        style = MaterialTheme.typography.bodyLarge.copy(lineBreak = LineBreak.Paragraph),
                        color = if (line.isError) colors.error else colors.onSurfaceVariant,
                        textAlign = if (line.isError) TextAlign.Start else TextAlign.Center,
                    )
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = if (state is AuthUiState.NoGoogleAccount) onAddAccount else onGoogle,
                    enabled = !busy,
                    modifier = ButtonModifier,
                ) {
                    ButtonLabel(googleLabelOf(state))
                }
                OutlinedButton(onClick = onGuest, enabled = !busy, modifier = ButtonModifier) {
                    ButtonLabel("Continue as guest")
                }
                TextButton(onClick = onSkip, enabled = !busy, modifier = ButtonModifier) {
                    ButtonLabel("Skip and read what is on this phone")
                }
                if (state is AuthUiState.Loading && state.canCancel) {
                    TextButton(onClick = onCancel, modifier = ButtonModifier) {
                        ButtonLabel("Cancel sign-in")
                    }
                }
            }
        }
    }
}

@Composable
private fun ButtonLabel(text: String) {
    Text(text, textAlign = TextAlign.Center)
}

/** The words of the state line and whether they tell a failure. */
private data class StateLine(val text: String, val isError: Boolean)

private fun lineOf(state: AuthUiState): StateLine = when (state) {
    AuthUiState.SignedOut -> StateLine("Keep your articles on every device.", isError = false)
    is AuthUiState.Loading, is AuthUiState.SignedIn -> StateLine("Signing you in…", isError = false)
    AuthUiState.NoGoogleAccount -> StateLine(ErrorMessage.GOOGLE_NO_ACCOUNT.text, isError = true)
    is AuthUiState.Error -> StateLine(signInText(state.message, state.account), isError = true)
}

/** The first button: Google failures offer to try Google again; no account offers to add one. */
private fun googleLabelOf(state: AuthUiState): String = when {
    state is AuthUiState.NoGoogleAccount -> "Add a Google account"
    state is AuthUiState.Error && state.message in GOOGLE_FAILURES -> "Try again with Google"
    else -> "Continue with Google"
}

private val GOOGLE_FAILURES = setOf(
    ErrorMessage.GOOGLE_OFFLINE,
    ErrorMessage.GOOGLE_NO_ACCOUNT,
    ErrorMessage.GOOGLE_FAILED,
)

private val PANEL_MAX_WIDTH = 360.dp

private val ButtonModifier = Modifier
    .fillMaxWidth()
    .heightIn(min = 48.dp)

private val NameStyle = TextStyle(
    fontFamily = noricanFont,
    fontSize = 28.sp,
    lineHeight = 36.sp,
)

@Composable
private fun SignInPanelPreview(state: AuthUiState, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            SignInPanel(
                state = state,
                onGoogle = {},
                onGuest = {},
                onSkip = {},
                onCancel = {},
                onAddAccount = {},
            )
        }
    }
}

/** The longest words the panel shows: a long address in the failed line. */
internal val WORST_SIGN_IN_STATE = AuthUiState.Error(
    ErrorMessage.GOOGLE_FAILED,
    account = "aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org",
)

@Preview(name = "Sign-in • default • light", showBackground = true, widthDp = 411, heightDp = 891)
@Composable
private fun SignInDefaultPreview() = SignInPanelPreview(AuthUiState.SignedOut)

@Preview(
    name = "Sign-in • default • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 891,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun SignInDefaultDarkPreview() = SignInPanelPreview(AuthUiState.SignedOut, darkTheme = true)

@Preview(name = "Sign-in • no Google account", showBackground = true, widthDp = 411, heightDp = 891)
@Composable
private fun SignInEmptyPreview() = SignInPanelPreview(AuthUiState.NoGoogleAccount)

@Preview(name = "Sign-in • loading", showBackground = true, widthDp = 411, heightDp = 891)
@Composable
private fun SignInLoadingPreview() = SignInPanelPreview(AuthUiState.Loading())

@Preview(name = "Sign-in • error • dark", showBackground = true, widthDp = 411, heightDp = 891,
    uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SignInErrorPreview() =
    SignInPanelPreview(AuthUiState.Error(ErrorMessage.GOOGLE_OFFLINE), darkTheme = true)

@Preview(name = "Sign-in • worst", showBackground = true, widthDp = 320, heightDp = 640, fontScale = 2f)
@Composable
private fun SignInWorstPreview() = SignInPanelPreview(WORST_SIGN_IN_STATE)
