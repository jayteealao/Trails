package com.jayteealao.trails.screens.articleDetail

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.screens.theme.TrailsTheme

/**
 * The state of the archive in one slim row, a sibling above the tab row: an icon, the words, and
 * Try again when the archive failed. The row never lies over the text, and it wraps rather than
 * hiding words. The words are a polite live region, so a change is read out; the icon repeats
 * them and is hidden from screen readers.
 */
@Composable
fun ArchiveStatusRow(row: ArchiveRow, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Column(modifier.fillMaxWidth().background(colors.surface)) {
        HorizontalDivider(thickness = Dp.Hairline, color = colors.outlineVariant)
        Row(
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Horizontal))
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (row.isError) ReaderNoticeIcons.Failed else ReaderNoticeIcons.Waiting,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = if (row.isError) colors.error else colors.onSurfaceVariant,
            )
            Text(
                text = row.words,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 8.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 20.sp),
                color = colors.onSurfaceVariant,
            )
            if (row.canRetry) {
                TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("Try again")
                }
            }
        }
    }
}

@Composable
private fun ArchiveStatusRowPreviews(darkTheme: Boolean = false) {
    val states = listOf(
        "processing" to ArchiveRetryState.Idle,
        "failed" to ArchiveRetryState.Sending(),
        "failed" to ArchiveRetryState.Idle,
        "failed" to ArchiveRetryState.NotSent(RetryFailure.OFFLINE),
        "failed" to ArchiveRetryState.NotRetryable,
    )
    TrailsTheme(darkTheme = darkTheme) {
        Column {
            states.forEach { (status, retry) ->
                archiveRowFor(hasText = true, status = status, retry = retry)
                    ?.let { ArchiveStatusRow(it, onRetry = {}) }
            }
        }
    }
}

@Preview(name = "Archive status row • light", showBackground = true, widthDp = 411)
@Composable
private fun ArchiveStatusRowLightPreview() {
    ArchiveStatusRowPreviews()
}

@Preview(
    name = "Archive status row • dark",
    showBackground = true,
    widthDp = 411,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArchiveStatusRowDarkPreview() {
    ArchiveStatusRowPreviews(darkTheme = true)
}

/** At twice the font size the words wrap beside Try again. */
@Preview(name = "Archive status row • large font", showBackground = true, widthDp = 360, fontScale = 2f)
@Composable
private fun ArchiveStatusRowLargeFontPreview() {
    ArchiveStatusRowPreviews()
}

/** A word longer than the row breaks inside the word. */
@Preview(name = "Archive status row • long words", showBackground = true, widthDp = 360)
@Composable
private fun ArchiveStatusRowLongWordsPreview() {
    TrailsTheme(darkTheme = false) {
        ArchiveStatusRow(
            row = ArchiveRow(
                words = "Die Archivierungsbenachrichtigungseinstellungen konnten nicht übernommen werden.",
                isError = true,
                canRetry = true,
            ),
            onRetry = {},
        )
    }
}
