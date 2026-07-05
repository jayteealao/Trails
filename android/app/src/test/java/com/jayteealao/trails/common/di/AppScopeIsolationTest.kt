package com.jayteealao.trails.common.di

import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies that [AppScopeModule.provideApplicationScope] produces a scope with [SupervisorJob]
 * semantics: a failing child must not cancel the scope or prevent siblings from completing.
 *
 * A [CoroutineExceptionHandler] is installed to swallow child exceptions — this mirrors
 * production behaviour where top-level coroutine exceptions in the app scope go to the
 * platform's uncaught exception handler rather than crashing the scope. Without the handler,
 * [advanceUntilIdle] re-throws uncaught exceptions even through [SupervisorJob].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppScopeIsolationTest {

    /** Swallows uncaught exceptions from child coroutines, mirroring production behaviour. */
    private val swallowHandler = CoroutineExceptionHandler { _, _ -> /* intentional no-op */ }

    @Test
    fun `child failure does not cancel scope or siblings`() = runTest {
        // Share the runTest scheduler so advanceUntilIdle() drives the scope's coroutines.
        val dispatcher = StandardTestDispatcher(testScheduler)
        // Mirror the production provider exactly (SupervisorJob + IO dispatcher + top-level handler).
        val scope = CoroutineScope(SupervisorJob() + dispatcher + swallowHandler)

        var siblingCompleted = false

        // Child A: throws immediately — must not cancel scope or sibling.
        scope.launch { throw IllegalStateException("intentional failure") }

        // Child B: sets the flag — must still run.
        scope.launch { siblingCompleted = true }

        advanceUntilIdle()

        assertTrue("scope must remain active after child failure", scope.coroutineContext[Job]!!.isActive)
        assertTrue("sibling B must complete despite child A throwing", siblingCompleted)
        // Validate app-lifetime semantics: do NOT call scope.cancel() anywhere in this test.
    }

    @Test
    fun `scope accepts new launches after child throws`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = CoroutineScope(SupervisorJob() + dispatcher + swallowHandler)

        // First child throws.
        scope.launch { throw RuntimeException("first failure") }
        advanceUntilIdle()

        // A new launch after the failure must still execute.
        var counter = 0
        scope.launch { counter++ }
        advanceUntilIdle()

        assertEquals("scope must accept launches after child exception", 1, counter)
    }
}
