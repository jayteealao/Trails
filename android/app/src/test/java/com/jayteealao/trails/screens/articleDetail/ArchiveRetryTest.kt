package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.archive.ArchiveRetryAnswer
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.Complete
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.Idle
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.NotRetryable
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.NotSent
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.Sending
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState.Waiting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The moves of an archive retry, and the status row for every status. */
class ArchiveRetryTest {

    private val notSent: List<ArchiveRetryState> = RetryFailure.entries.map { NotSent(it) }
    private val resting: List<ArchiveRetryState> = notSent + Idle + NotRetryable
    private val trying: List<ArchiveRetryState> = listOf(Sending(false), Sending(true), Waiting(false), Waiting(true))
    private val allStates: List<ArchiveRetryState> = resting + trying + Complete

    private val retryable: List<String?> = listOf("failed", "abandoned", "partial")
    private val silent: List<String?> = listOf(null, "pending", "complete", "someday", "")
    private val allStatuses = retryable + silent + "processing"

    // --- The moves ---

    @Test
    fun `a tap sends from rest and from a retry that was not sent, for a status the server runs again`() {
        for (state in notSent + Idle) {
            for (status in allStatuses) {
                val expected = if (status in retryable) Sending() else state
                assertEquals("$state $status", expected, state.onTap(status))
            }
        }
    }

    @Test
    fun `a tap is ignored in every other state`() {
        for (state in trying + Complete + NotRetryable) {
            for (status in allStatuses) assertEquals("$state $status", state, state.onTap(status))
        }
    }

    @Test
    fun `processing is remembered while a retry is on its way or waits`() {
        assertEquals(Sending(true), Sending(false).onStatus("processing"))
        assertEquals(Waiting(true), Waiting(false).onStatus("processing"))
    }

    @Test
    fun `a request on its way is not ended by any status`() {
        for (status in retryable + silent) {
            assertEquals("$status", Sending(false), Sending(false).onStatus(status))
            assertEquals("$status", Sending(true), Sending(true).onStatus(status))
        }
    }

    @Test
    fun `a wait ends when the archive completes, or fails after it was processing`() {
        assertEquals(Idle, Waiting(false).onStatus("complete"))
        assertEquals(Idle, Waiting(true).onStatus("complete"))
        for (status in retryable) {
            assertEquals("$status", Waiting(false), Waiting(false).onStatus(status))
            assertEquals("$status", Idle, Waiting(true).onStatus(status))
        }
        for (status in silent - "complete") {
            assertEquals("$status", Waiting(true), Waiting(true).onStatus(status))
        }
    }

    @Test
    fun `a complete answer ends when the status moves on`() {
        assertEquals(Idle, Complete.onStatus("processing"))
        assertEquals(Idle, Complete.onStatus("complete"))
        assertEquals(Complete, Complete.onStatus("failed"))
    }

    @Test
    fun `a status leaves a resting state as it is`() {
        for (state in resting) {
            for (status in allStatuses) assertEquals("$state $status", state, state.onStatus(status))
        }
    }

    @Test
    fun `an accepted answer waits, or ends when the run has settled already`() {
        assertEquals(Waiting(false), Sending(false).onAnswer(ArchiveRetryAnswer.Accepted, "failed"))
        assertEquals(Waiting(true), Sending(true).onAnswer(ArchiveRetryAnswer.Accepted, "processing"))
        assertEquals(Idle, Sending(true).onAnswer(ArchiveRetryAnswer.Accepted, "failed"))
        assertEquals(Idle, Sending(false).onAnswer(ArchiveRetryAnswer.Accepted, "complete"))
    }

    @Test
    fun `processing then failed before an accepted answer offers a retry again`() {
        val state = Idle.onTap("failed").onStatus("processing").onStatus("failed")
            .onAnswer(ArchiveRetryAnswer.Accepted, "failed")
        assertEquals(Idle, state)
    }

    @Test
    fun `a refused retry says so, whatever the server wrote meanwhile`() {
        val refused = ArchiveRetryAnswer.NotSent(RetryFailure.REFUSED)
        val statusFirst = Idle.onTap("failed").onStatus("processing").onStatus("failed").onAnswer(refused, "failed")
        assertEquals(NotSent(RetryFailure.REFUSED), statusFirst)
        val answerFirst = Idle.onTap("failed").onAnswer(refused, "failed").onStatus("processing").onStatus("failed")
        assertEquals(NotSent(RetryFailure.REFUSED), answerFirst)
    }

    @Test
    fun `the other answers give their own state`() {
        assertEquals(Complete, Sending().onAnswer(ArchiveRetryAnswer.Complete, "failed"))
        assertEquals(Idle, Sending().onAnswer(ArchiveRetryAnswer.Complete, "complete"))
        assertEquals(NotRetryable, Sending().onAnswer(ArchiveRetryAnswer.NotRetryable, "failed"))
        for (failure in RetryFailure.entries) {
            assertEquals(NotSent(failure), Sending().onAnswer(ArchiveRetryAnswer.NotSent(failure), "failed"))
        }
    }

    @Test
    fun `an answer moves only a request on its way`() {
        for (state in allStates.filterNot { it is Sending }) {
            assertEquals("$state", state, state.onAnswer(ArchiveRetryAnswer.NotRetryable, "failed"))
        }
    }

    @Test
    fun `a reopen ends a wait and a message, and keeps a request on its way`() {
        for (state in allStates) {
            val kept = state is Sending || state == NotRetryable
            assertEquals("$state", if (kept) state else Idle, state.onReopen())
        }
    }

    @Test
    fun `back online clears only the offline message`() {
        for (state in allStates) {
            assertEquals("$state", if (state == NotSent(RetryFailure.OFFLINE)) Idle else state, state.onOnline())
        }
    }

    // --- The row ---

    @Test
    fun `no text has no row`() {
        for (status in allStatuses) {
            for (state in allStates) assertNull("$status $state", archiveRowFor(false, status, state))
        }
    }

    @Test
    fun `a complete, pending or unknown status has no row`() {
        for (status in silent) {
            for (state in allStates) assertNull("$status $state", archiveRowFor(true, status, state))
        }
    }

    @Test
    fun `a processing archive says so with no action`() {
        for (state in resting + Complete) {
            assertEquals(
                ArchiveRow("Still archiving this page", isError = false, canRetry = false),
                archiveRowFor(true, "processing", state),
            )
        }
    }

    @Test
    fun `a running retry says so with no action`() {
        for (status in retryable + "processing") {
            for (state in trying) {
                assertEquals(
                    ArchiveRow("Trying the archive again", isError = false, canRetry = false),
                    archiveRowFor(true, status, state),
                )
            }
        }
    }

    @Test
    fun `a failed archive says the text is kept and offers Try again`() {
        for (status in retryable) {
            assertEquals(
                ArchiveRow("The archive failed. This text is kept.", isError = true, canRetry = true),
                archiveRowFor(true, status, Idle),
            )
            assertNull(archiveRowFor(true, status, Complete))
        }
    }

    @Test
    fun `a retry that was not sent says why and keeps Try again`() {
        val words = mapOf(
            RetryFailure.OFFLINE to "The retry was not sent because you’re offline. This text is kept.",
            RetryFailure.SIGNED_OUT to "The retry was not sent because you’re signed out. Sign in and try again.",
            RetryFailure.REFUSED to "The archive service did not take the retry. This text is kept.",
            RetryFailure.NO_ANSWER to "The retry got no answer. This text is kept.",
        )
        assertEquals(RetryFailure.entries.toSet(), words.keys)
        for ((failure, line) in words) {
            assertEquals(ArchiveRow(line, isError = true, canRetry = true), archiveRowFor(true, "failed", NotSent(failure)))
        }
    }

    @Test
    fun `a page that cannot be archived again offers no Try again`() {
        assertEquals(
            ArchiveRow("This page can’t be archived again. This text is kept.", isError = true, canRetry = false),
            archiveRowFor(true, "failed", NotRetryable),
        )
    }
}
