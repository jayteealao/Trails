package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.archive.ArchiveRetryAnswer
import com.jayteealao.trails.data.archive.RetryFailure

/** The statuses whose archive the server runs again; see [FAILED_STATUSES]. */
internal val RETRYABLE_STATUSES = FAILED_STATUSES + "partial"

/** Where a retry of one article's archive stands. The functions below are its only moves. */
sealed interface ArchiveRetryState {

    data object Idle : ArchiveRetryState

    /** The request is on its way. [sawProcessing]: the server has said processing since the tap. */
    data class Sending(val sawProcessing: Boolean = false) : ArchiveRetryState

    /** The request was accepted, and the run has not settled. */
    data class Waiting(val sawProcessing: Boolean) : ArchiveRetryState

    /** The server said the archive is complete; the status on the phone does not say so yet. */
    data object Complete : ArchiveRetryState

    data class NotSent(val failure: RetryFailure) : ArchiveRetryState

    data object NotRetryable : ArchiveRetryState
}

/** A retry is on its way or running, so a second one must not start. */
val ArchiveRetryState.isTrying: Boolean
    get() = this is ArchiveRetryState.Sending || this is ArchiveRetryState.Waiting

/** A tap on Try again: sends only from rest, and only for a status the server runs again. */
fun ArchiveRetryState.onTap(status: String?): ArchiveRetryState = when (this) {
    ArchiveRetryState.Idle, is ArchiveRetryState.NotSent ->
        if (status in RETRYABLE_STATUSES) ArchiveRetryState.Sending() else this
    else -> this
}

/** The server's status of the article is now [status]. */
fun ArchiveRetryState.onStatus(status: String?): ArchiveRetryState = when (this) {
    is ArchiveRetryState.Sending -> if (status == PROCESSING) copy(sawProcessing = true) else this
    is ArchiveRetryState.Waiting ->
        if (status == PROCESSING) copy(sawProcessing = true) else settledOr(status, sawProcessing)
    ArchiveRetryState.Complete ->
        if (status == PROCESSING || status == COMPLETE) ArchiveRetryState.Idle else this
    else -> this
}

/** The answer of the request arrived; [status] is the last status of the article. */
fun ArchiveRetryState.onAnswer(answer: ArchiveRetryAnswer, status: String?): ArchiveRetryState {
    if (this !is ArchiveRetryState.Sending) return this
    return when (answer) {
        ArchiveRetryAnswer.Accepted -> ArchiveRetryState.Waiting(sawProcessing).settledOr(status, sawProcessing)
        ArchiveRetryAnswer.Complete -> ArchiveRetryState.Complete.onStatus(status)
        ArchiveRetryAnswer.NotRetryable -> ArchiveRetryState.NotRetryable
        is ArchiveRetryAnswer.NotSent -> ArchiveRetryState.NotSent(answer.failure)
    }
}

/** The article was opened again: an old message, or a wait whose status never moved, ends. */
fun ArchiveRetryState.onReopen(): ArchiveRetryState = when (this) {
    is ArchiveRetryState.Waiting, ArchiveRetryState.Complete, is ArchiveRetryState.NotSent -> ArchiveRetryState.Idle
    else -> this
}

/** The phone is online, so a retry that was not sent because it was offline can be sent. */
fun ArchiveRetryState.onOnline(): ArchiveRetryState =
    if (this == ArchiveRetryState.NotSent(RetryFailure.OFFLINE)) ArchiveRetryState.Idle else this

/**
 * A wait ends at [status] complete, or at a status that can be retried once the server has been
 * seen processing; before that the status is the failure the tap was about.
 */
private fun ArchiveRetryState.settledOr(status: String?, sawProcessing: Boolean): ArchiveRetryState =
    if (status == COMPLETE || (sawProcessing && status in RETRYABLE_STATUSES)) ArchiveRetryState.Idle else this

private const val PROCESSING = "processing"
private const val COMPLETE = "complete"

/**
 * The status row of an article that has text.
 *
 * @property isError the archive failed; the icon is in the error colour, beside the words.
 * @property canRetry the row offers Try again.
 */
data class ArchiveRow(val words: String, val isError: Boolean, val canRetry: Boolean)

/** The status row above the tabs, or null when there is nothing to say; see [ArchiveRow]. */
fun archiveRowFor(hasText: Boolean, status: String?, retry: ArchiveRetryState): ArchiveRow? = when {
    !hasText -> null
    // A complete, pending or unknown archive has no row: unknown is never read as failed.
    status != PROCESSING && status !in RETRYABLE_STATUSES -> null
    retry.isTrying -> ArchiveRow("Trying the archive again", isError = false, canRetry = false)
    status == PROCESSING -> ArchiveRow("Still archiving this page", isError = false, canRetry = false)
    retry == ArchiveRetryState.Complete -> null
    else -> ArchiveRow(
        words = failedRowWords(retry),
        isError = true,
        canRetry = retry != ArchiveRetryState.NotRetryable,
    )
}

private fun failedRowWords(retry: ArchiveRetryState): String = when (retry) {
    is ArchiveRetryState.NotSent -> when (retry.failure) {
        RetryFailure.OFFLINE -> "The retry was not sent because you’re offline. This text is kept."
        RetryFailure.SIGNED_OUT -> "The retry was not sent because you’re signed out. Sign in and try again."
        RetryFailure.REFUSED -> "The archive service did not take the retry. This text is kept."
        RetryFailure.NO_ANSWER -> "The retry got no answer. This text is kept."
    }
    ArchiveRetryState.NotRetryable -> "This page can’t be archived again. This text is kept."
    else -> "The archive failed. This text is kept."
}

/** The line of the failed Reader notice after a retry that did not start, else its own line. */
internal fun failedNoticeLine(retry: ArchiveRetryState): String = when (retry) {
    is ArchiveRetryState.NotSent -> when (retry.failure) {
        RetryFailure.OFFLINE -> "The retry was not sent because you’re offline. Try again when you’re back online."
        RetryFailure.SIGNED_OUT -> "The retry was not sent because you’re signed out. Sign in and try again."
        RetryFailure.REFUSED -> "The archive service did not take the retry. Try again, or read it on the Web tab."
        RetryFailure.NO_ANSWER -> "The retry got no answer. Try again, or read it on the Web tab."
    }
    ArchiveRetryState.NotRetryable -> "This page can’t be archived again. Read it on the Web tab."
    else -> ReaderNoticeKind.FAILED.line
}
