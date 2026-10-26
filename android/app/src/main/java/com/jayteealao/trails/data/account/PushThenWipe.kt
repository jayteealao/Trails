package com.jayteealao.trails.data.account

import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import kotlin.time.Duration.Companion.seconds

/** Why the local library is being cleared. */
enum class WipeReason { CLEAR_DATA, ACCOUNT_SWITCH }

enum class PushThenWipeResult { WIPED, KEPT }

/** What the unsynced-changes dialog shows. */
sealed interface UnsyncedChangesDialogState {
    data object Hidden : UnsyncedChangesDialogState
    data class Pushing(val count: Int) : UnsyncedChangesDialogState
    data class PushFailed(
        val count: Int,
        val reason: WipeReason,
        val ownerLabel: String?,
    ) : UnsyncedChangesDialogState
    data object Wiping : UnsyncedChangesDialogState
}

/**
 * Clear the local library without silently losing changes: pending changes are pushed
 * first (at most [PUSH_LIMIT]), and when some stay unsent the person decides.
 */
class PushThenWipe @Inject constructor(
    private val reset: LocalDataReset,
) {
    /**
     * @param canPush true only when the signed-in user owns the local data; otherwise
     *   the push is treated as failed, since it would copy the data into another account.
     * @param onState receives each dialog state; always ends with [UnsyncedChangesDialogState.Hidden].
     * @param confirm asks the person whether to clear anyway after a failed push.
     *
     * Cancelling the caller while pushing wipes nothing.
     */
    suspend fun run(
        reason: WipeReason,
        ownerLabel: String?,
        canPush: Boolean,
        onState: (UnsyncedChangesDialogState) -> Unit,
        confirm: suspend (UnsyncedChangesDialogState.PushFailed) -> Boolean,
    ): PushThenWipeResult {
        try {
            var count = reset.pendingChangeCount()
            if (count > 0) {
                if (canPush) {
                    onState(UnsyncedChangesDialogState.Pushing(count))
                    withTimeoutOrNull(PUSH_LIMIT) { reset.pushPendingChanges() }
                    // Count what is left whatever the push reported: a push stamps what it
                    // sent, and a clean push still leaves the articles it skipped after
                    // repeated failures, whose latest changes are only on this device.
                    count = reset.pendingChangeCount()
                }
                if (count > 0) {
                    val failed = UnsyncedChangesDialogState.PushFailed(count, reason, ownerLabel)
                    onState(failed)
                    if (!confirm(failed)) return PushThenWipeResult.KEPT
                }
            }
            onState(UnsyncedChangesDialogState.Wiping)
            reset.wipeLocalData()
            return PushThenWipeResult.WIPED
        } finally {
            onState(UnsyncedChangesDialogState.Hidden)
        }
    }

    companion object {
        val PUSH_LIMIT = 15.seconds
    }
}

/** "1 change", "42 changes", or "More than 999 changes" above 999. */
internal fun unsyncedChangesText(count: Int): String = when {
    count == 1 -> "1 change"
    count > 999 -> "More than 999 changes"
    else -> "$count changes"
}
