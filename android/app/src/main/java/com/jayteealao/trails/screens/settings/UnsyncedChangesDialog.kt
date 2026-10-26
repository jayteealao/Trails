package com.jayteealao.trails.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Hidden
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.PushFailed
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Pushing
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Wiping
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.data.account.unsyncedChangesText

/**
 * The dialog of a local-data wipe: backing up pending changes, the push-failed question
 * (clear data or account switch), and the wipe itself. Renders nothing when [state] is
 * [Hidden]. Colours come from the theme only: the container is the theme's dialog role and
 * the destructive action uses `colorScheme.error`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UnsyncedChangesDialog(
    state: UnsyncedChangesDialogState,
    onKeep: () -> Unit,
    onConfirm: () -> Unit,
    onCancelPush: () -> Unit,
) {
    when (state) {
        Hidden -> Unit
        is Pushing -> AlertDialog(
            onDismissRequest = onCancelPush,
            properties = DialogProperties(dismissOnClickOutside = false),
            title = { Text("Backing up changes") },
            text = {
                Column {
                    Text(countText("Sending ", state.count, " to your account before clearing this device."))
                    WipeProgress(description = "Backing up")
                    Text(
                        text = "This stops on its own if there is no connection.",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            },
            confirmButton = { DialogTextButton("Cancel", onClick = onCancelPush) },
        )
        is PushFailed -> {
            val one = state.count == 1
            val switch = state.reason == WipeReason.ACCOUNT_SWITCH
            val verb = if (one) " is" else " are"
            val pronoun = if (one) "it" else "them"
            AlertDialog(
                onDismissRequest = onKeep,
                properties = DialogProperties(dismissOnClickOutside = false),
                title = {
                    Text(
                        when {
                            switch -> "Sign in to a different account?"
                            one -> "Change not backed up"
                            else -> "Changes not backed up"
                        }
                    )
                },
                text = {
                    Column {
                        val consequence = if (switch) {
                            " Signing in to another account clears this device and deletes $pronoun."
                        } else {
                            " Clearing data deletes $pronoun."
                        }
                        Text(countText("", state.count, " on this device$verb not backed up.$consequence"))
                        if (switch) CurrentAccount(state.ownerLabel)
                    }
                },
                // Both actions in one flow row: "Keep data" comes first, so it sits on the left
                // and, when the buttons stack at a large font scale, on top (the safe choice
                // reads as the default). The dialog's own button row stacks confirm first.
                confirmButton = {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                        DialogTextButton("Keep data", onClick = onKeep)
                        DialogTextButton(
                            text = if (switch) "Switch anyway" else "Clear anyway",
                            onClick = onConfirm,
                            destructive = true,
                        )
                    }
                },
            )
        }
        Wiping -> AlertDialog(
            // The wipe cannot be interrupted half-way: no buttons, back does nothing.
            onDismissRequest = {},
            properties = DialogProperties(dismissOnClickOutside = false, dismissOnBackPress = false),
            title = { Text("Clearing data") },
            text = {
                Column {
                    Text("Deleting articles, tags and archived pages from this device.")
                    WipeProgress(description = "Clearing")
                }
            },
            confirmButton = {},
        )
    }
}

/**
 * [prefix], then the count in bold ("42 changes"), then [suffix]: the count leads what is read.
 * After a prefix the count is mid-sentence, so "More than 999 changes" starts lower case.
 */
@Composable
private fun countText(prefix: String, count: Int, suffix: String): AnnotatedString = buildAnnotatedString {
    append(prefix)
    withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) {
        val phrase = unsyncedChangesText(count)
        append(if (prefix.isEmpty()) phrase else phrase.replaceFirstChar { it.lowercaseChar() })
    }
    append(suffix)
}

@Composable
private fun WipeProgress(description: String) {
    LinearProgressIndicator(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp)
            .semantics { contentDescription = description },
    )
}

@Composable
private fun CurrentAccount(ownerLabel: String?) {
    Column(modifier = Modifier.padding(top = 16.dp)) {
        Text(text = "Current account", style = MaterialTheme.typography.bodySmall)
        Text(
            text = ownerLabel ?: "Guest account",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            // A long address keeps its start and its domain.
            overflow = TextOverflow.MiddleEllipsis,
        )
    }
}

@Composable
private fun DialogTextButton(text: String, onClick: () -> Unit, destructive: Boolean = false) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.heightIn(min = 48.dp),
        colors = if (destructive) {
            ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
        } else {
            ButtonDefaults.textButtonColors()
        },
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}
