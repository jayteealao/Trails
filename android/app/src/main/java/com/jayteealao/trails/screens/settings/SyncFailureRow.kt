package com.jayteealao.trails.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.data.local.database.MAX_SYNC_FAILURES

/**
 * The Settings sync-section row for articles the sync skipped after [MAX_SYNC_FAILURES]
 * failed runs. Not composed at all when [count] is 0. Retry resets the counters and runs
 * one sync; while it runs the row shows progress and Retry stays focusable, reads as
 * "Retrying" and ignores taps. After a Retry that did not finish cleanly ([retryFailed]) the
 * row stays with a failed line and Retry stays available. The text is a polite live region,
 * so a change is announced.
 */
@Composable
fun SyncFailureRow(
    count: Int,
    isRetrying: Boolean,
    retryFailed: Boolean = false,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (count <= 0) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_sync_problem),
            // The text carries the meaning.
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        ) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(count.toString()) }
                    append(if (count == 1) " article failed to sync" else " articles failed to sync")
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Skipped after $MAX_SYNC_FAILURES tries. Their latest changes are only on this device.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (retryFailed) {
                Text(
                    text = RETRY_FAILED_LINE,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(
            modifier = Modifier.align(Alignment.CenterVertically),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isRetrying) {
                CircularProgressIndicator(
                    // Retry itself reads as "Retrying", so the spinner adds nothing to say.
                    modifier = Modifier
                        .size(16.dp)
                        .semantics { invisibleToUser() },
                    strokeWidth = 2.dp,
                )
            }
            // Stays enabled while retrying so focus does not drop off a disabled control.
            TextButton(
                onClick = { if (!isRetrying) onRetry() },
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .semantics { if (isRetrying) stateDescription = "Retrying" },
            ) {
                Text(text = "Retry", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

internal const val RETRY_FAILED_LINE = "Retry failed. Will try again on the next sync."
