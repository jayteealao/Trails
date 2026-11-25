package com.jayteealao.trails.screens.share

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.components.TRY_AGAIN
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.piazzollaFont
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** How long Undo stays, which is the time of the Undo of a deleted article. */
internal const val UNDO_MILLIS = 10_000L

/** The sheet goes at once in the background, where its animation would not end. */
private const val HIDE_MILLIS = 500L

private val TitleStyle = TextStyle(
    fontFamily = piazzollaFont,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
)

private enum class SheetIcon { WAITING, DONE, FAILED }

/** The words of one state of the sheet, and the actions it offers. */
private data class SheetWords(
    val icon: SheetIcon,
    val state: String,
    val title: String,
    val line: String,
    val undo: Boolean = false,
    val close: Boolean = false,
    val retry: Boolean = false,
)

private fun ShareState.words(): SheetWords = when (this) {
    ShareState.NoLink -> SheetWords(
        icon = SheetIcon.FAILED,
        state = "No link to save",
        title = "The shared text has no web address",
        line = "Share a page or a link that starts with http.",
        close = true,
    )

    is ShareState.Save -> when (phase) {
        SavePhase.SAVING -> SheetWords(SheetIcon.WAITING, "Saving…", title, host, close = true)
        SavePhase.SAVED, SavePhase.UNDOING, SavePhase.UNDONE ->
            SheetWords(SheetIcon.DONE, "Saved", title, host, undo = true)

        SavePhase.ALREADY_SAVED -> SheetWords(SheetIcon.DONE, "Already in your library", title, host, close = true)
        SavePhase.NOT_SAVED -> SheetWords(
            icon = SheetIcon.FAILED,
            state = "Not saved",
            title = title,
            line = "This phone could not store the article. Try again.",
            close = true,
            retry = true,
        )

        SavePhase.NOT_UNDONE -> SheetWords(
            icon = SheetIcon.FAILED,
            state = "Not removed",
            title = title,
            line = "This phone could not remove the article. Try again.",
            close = true,
            retry = true,
        )
    }
}

private val ShareState.phaseOrNull: SavePhase?
    get() = (this as? ShareState.Save)?.phase

/**
 * The save of a shared link in a bottom sheet. It closes by itself when the time to undo has ended
 * or the article was removed; what failed stays until it is closed, because it must be read.
 * [onClosed] is called once, when the sheet has gone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(
    state: ShareState,
    onUndo: () -> Unit,
    onRetry: () -> Unit,
    onClosed: () -> Unit,
    undoMillis: Long = UNDO_MILLIS,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val accessibility = LocalAccessibilityManager.current
    val currentOnClosed by rememberUpdatedState(onClosed)
    var closing by remember { mutableStateOf(false) }
    var closed by remember { mutableStateOf(false) }

    fun end() {
        if (closed) return
        closed = true
        currentOnClosed()
    }

    fun close() {
        if (closing) return
        closing = true
        scope.launch {
            withTimeoutOrNull(HIDE_MILLIS) { sheetState.hide() }
            end()
        }
    }

    // Keyed on the phase, so a title that comes late does not start the time again.
    val phase = state.phaseOrNull
    LaunchedEffect(phase) {
        when (phase) {
            SavePhase.SAVED, SavePhase.ALREADY_SAVED -> {
                delay(
                    accessibility?.calculateRecommendedTimeoutMillis(
                        originalTimeoutMillis = undoMillis,
                        containsIcons = true,
                        containsText = true,
                        containsControls = true,
                    ) ?: undoMillis,
                )
                close()
            }

            SavePhase.UNDONE -> close()
            else -> Unit
        }
    }

    ModalBottomSheet(
        onDismissRequest = ::end,
        modifier = Modifier.semantics { paneTitle = "Save to Trails" },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = null,
    ) {
        ShareSheetContent(
            state = state,
            // A sheet on its way out would take the answer of an undo with it.
            onUndo = { if (!closing) onUndo() },
            onRetry = onRetry,
            onClose = ::close,
        )
    }
}

/** The state of the save, the title and host of the article, and the actions that fit the state. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShareSheetContent(
    state: ShareState,
    onUndo: () -> Unit,
    onRetry: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val words = state.words()
    val stateColor = if (words.icon == SheetIcon.FAILED) colors.error else colors.primary
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(bottom = 8.dp),
        ) {
            Icon(
                painter = words.icon.painter(),
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = stateColor,
            )
            Text(
                text = words.state,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                color = stateColor,
            )
        }
        Text(
            text = words.title,
            modifier = Modifier.semantics { heading() },
            style = TitleStyle,
            color = colors.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = words.line,
            modifier = Modifier.padding(top = 4.dp),
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 20.sp),
            color = colors.onSurfaceVariant,
        )
        // Each button is 40 dp to look at and adds its own 48 dp touch target.
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            if (words.close) TextButton(onClick = onClose) { Text("Close") }
            if (words.undo) {
                TextButton(onClick = onUndo, enabled = state.phaseOrNull == SavePhase.SAVED) { Text("Undo") }
            }
            if (words.retry) Button(onClick = onRetry) { Text(TRY_AGAIN) }
        }
    }
}

@Composable
private fun SheetIcon.painter(): Painter = when (this) {
    SheetIcon.WAITING -> rememberVectorPainter(ReaderNoticeIcons.Waiting)
    SheetIcon.DONE -> painterResource(R.drawable.check_24px)
    SheetIcon.FAILED -> rememberVectorPainter(ReaderNoticeIcons.Failed)
}

private val PREVIEW_SAVE = ShareState.Save(
    title = "Counting the street trees of a small city",
    host = "example.org",
    phase = SavePhase.SAVED,
)

@Composable
private fun SheetPreview(state: ShareState, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            ShareSheetContent(state, onUndo = {}, onRetry = {}, onClose = {})
        }
    }
}

@Preview(name = "Share sheet • light", widthDp = 411)
@Composable
private fun ShareSheetLightPreview() = SheetPreview(PREVIEW_SAVE)

@Preview(name = "Share sheet • dark", widthDp = 411, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ShareSheetDarkPreview() = SheetPreview(PREVIEW_SAVE, darkTheme = true)

@Preview(name = "Share sheet • no link", widthDp = 411)
@Composable
private fun ShareSheetEmptyPreview() = SheetPreview(ShareState.NoLink)

@Preview(name = "Share sheet • saving", widthDp = 411)
@Composable
private fun ShareSheetLoadingPreview() = SheetPreview(PREVIEW_SAVE.copy(phase = SavePhase.SAVING))

@Preview(name = "Share sheet • not saved", widthDp = 411)
@Composable
private fun ShareSheetErrorPreview() = SheetPreview(PREVIEW_SAVE.copy(phase = SavePhase.NOT_SAVED))

@Preview(name = "Share sheet • long words", widthDp = 360)
@Composable
private fun ShareSheetWorstPreview() = SheetPreview(
    ShareState.Save(
        title = "Benachrichtigungseinstellungen and other compound words: how Aleksandra " +
            "Wiśniewska-Kowalczyk rebuilt a forty-year-old newsletter in one very long summer",
        host = "reading-room.archive.the-longest-subdomain-in-the-list.example.org",
        phase = SavePhase.ALREADY_SAVED,
    ),
)
