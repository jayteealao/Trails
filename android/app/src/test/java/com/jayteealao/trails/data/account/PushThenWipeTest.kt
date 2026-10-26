package com.jayteealao.trails.data.account

import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Hidden
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.PushFailed
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Pushing
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState.Wiping
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

/**
 * The push-then-wipe sequence: the wipe never runs before the push attempt, and after a
 * failed, timed-out or skipped push never before the person confirms.
 */
class PushThenWipeTest {

    private lateinit var reset: LocalDataReset
    private lateinit var sequence: PushThenWipe
    private val states = mutableListOf<UnsyncedChangesDialogState>()

    @Before
    fun setUp() {
        reset = mockk()
        coEvery { reset.wipeLocalData() } returns Unit
        sequence = PushThenWipe(reset)
    }

    private suspend fun run(
        canPush: Boolean = true,
        reason: WipeReason = WipeReason.CLEAR_DATA,
        confirm: suspend (PushFailed) -> Boolean = { error("confirm must not be asked") },
    ) = sequence.run(reason, LABEL, canPush, onState = { states += it }, confirm = confirm)

    @Test
    fun nothingPending_wipesWithoutPushOrQuestion() = runTest {
        coEvery { reset.pendingChangeCount() } returns 0

        val result = run()

        assertEquals(PushThenWipeResult.WIPED, result)
        assertEquals(listOf(Wiping, Hidden), states)
        coVerify(exactly = 0) { reset.pushPendingChanges() }
        coVerify(exactly = 1) { reset.wipeLocalData() }
    }

    @Test
    fun pushSucceeds_pushesThenWipes() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 0)
        coEvery { reset.pushPendingChanges() } returns true

        val result = run()

        assertEquals(PushThenWipeResult.WIPED, result)
        assertEquals(listOf(Pushing(5), Wiping, Hidden), states)
        coVerifyOrder {
            reset.pushPendingChanges()
            reset.wipeLocalData()
        }
    }

    @Test
    fun pushSucceedsButSkippedArticlesRemain_asks_andWipesOnlyAfterConfirm() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 2)
        coEvery { reset.pushPendingChanges() } returns true
        var asked: PushFailed? = null
        var wipedBeforeConfirm = true

        val result = run(confirm = {
            asked = it
            coVerify(exactly = 0) { reset.wipeLocalData() }
            wipedBeforeConfirm = false
            true
        })

        assertEquals(PushThenWipeResult.WIPED, result)
        assertEquals(PushFailed(2, WipeReason.CLEAR_DATA, LABEL), asked)
        assertFalse(wipedBeforeConfirm)
        assertEquals(listOf(Pushing(5), PushFailed(2, WipeReason.CLEAR_DATA, LABEL), Wiping, Hidden), states)
        coVerify(exactly = 1) { reset.wipeLocalData() }
    }

    @Test
    fun pushSucceedsButSkippedArticlesRemain_keepingWipesNothing() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 2)
        coEvery { reset.pushPendingChanges() } returns true

        val result = run(confirm = { false })

        assertEquals(PushThenWipeResult.KEPT, result)
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun pushFails_asks_andKeepingWipesNothing() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 3)
        coEvery { reset.pushPendingChanges() } returns false
        var asked: PushFailed? = null

        val result = run(confirm = {
            asked = it
            coVerify(exactly = 0) { reset.wipeLocalData() }
            false
        })

        assertEquals(PushThenWipeResult.KEPT, result)
        assertEquals(PushFailed(3, WipeReason.CLEAR_DATA, LABEL), asked)
        assertEquals(listOf(Pushing(5), PushFailed(3, WipeReason.CLEAR_DATA, LABEL), Hidden), states)
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun pushFails_confirmingWipesOnce() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 3)
        coEvery { reset.pushPendingChanges() } returns false

        val result = run(confirm = {
            coVerify(exactly = 0) { reset.wipeLocalData() }
            true
        })

        assertEquals(PushThenWipeResult.WIPED, result)
        assertEquals(listOf(Pushing(5), PushFailed(3, WipeReason.CLEAR_DATA, LABEL), Wiping, Hidden), states)
        coVerify(exactly = 1) { reset.wipeLocalData() }
    }

    @Test
    fun pushTakesTooLong_asksAfter15Seconds_andWaitsForTheAnswer() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 4)
        coEvery { reset.pushPendingChanges() } coAnswers {
            delay(20.seconds)
            true
        }
        val answer = CompletableDeferred<Boolean>()
        var askedAt = -1L

        val run = async {
            run(confirm = {
                askedAt = currentTime
                answer.await()
            })
        }
        advanceUntilIdle()

        assertEquals(15_000L, askedAt)
        assertEquals(PushFailed(4, WipeReason.CLEAR_DATA, LABEL), states.last())
        coVerify(exactly = 0) { reset.wipeLocalData() }

        answer.complete(true)
        assertEquals(PushThenWipeResult.WIPED, run.await())
        coVerify(exactly = 1) { reset.wipeLocalData() }
    }

    @Test
    fun cannotPush_asksWithoutPushing() = runTest {
        coEvery { reset.pendingChangeCount() } returns 3

        val result = run(canPush = false, reason = WipeReason.ACCOUNT_SWITCH, confirm = { false })

        assertEquals(PushThenWipeResult.KEPT, result)
        assertEquals(listOf(PushFailed(3, WipeReason.ACCOUNT_SWITCH, LABEL), Hidden), states)
        coVerify(exactly = 0) { reset.pushPendingChanges() }
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun failedPushThatLeftNothing_wipesWithoutQuestion() = runTest {
        coEvery { reset.pendingChangeCount() } returnsMany listOf(5, 0)
        coEvery { reset.pushPendingChanges() } returns false

        val result = run()

        assertEquals(PushThenWipeResult.WIPED, result)
        assertFalse(states.any { it is PushFailed })
        coVerify(exactly = 1) { reset.wipeLocalData() }
    }

    @Test
    fun cancelWhilePushing_wipesNothing_andHidesTheDialog() = runTest {
        coEvery { reset.pendingChangeCount() } returns 5
        coEvery { reset.pushPendingChanges() } coAnswers {
            delay(10.seconds)
            true
        }

        val job = async { run() }
        runCurrent() // reaches the push, which waits on virtual time
        assertEquals(listOf<UnsyncedChangesDialogState>(Pushing(5)), states)

        job.cancel()
        runCurrent()

        assertTrue(job.isCancelled)
        assertEquals(Hidden, states.last())
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun unsyncedChangesText_pluralsAndCap() {
        assertEquals("1 change", unsyncedChangesText(1))
        assertEquals("42 changes", unsyncedChangesText(42))
        assertEquals("999 changes", unsyncedChangesText(999))
        assertEquals("More than 999 changes", unsyncedChangesText(1000))
    }

    private companion object {
        const val LABEL = "a@example.com"
    }
}
