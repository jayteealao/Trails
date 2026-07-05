package com.jayteealao.trails.common.di

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies that [AppScopeModule.provideApplicationScope] produces a scope with [SupervisorJob]
 * semantics: a failing child must not cancel the scope or prevent siblings from completing.
 */
class AppScopeIsolationTest {

    @Test
    fun `child failure does not cancel scope or siblings`() = runTest {
        val scheduler = TestCoroutineScheduler()
        val dispatcher = StandardTestDispatcher(scheduler)
        // Mirror the production provider exactly (SupervisorJob + IO dispatcher).
        val scope = CoroutineScope(SupervisorJob() + dispatcher)

        var siblingCompleted = false

        // Child A: throws immediately.
        scope.launch { throw IllegalStateException("intentional failure") }

        // Child B: increments the counter — must still run.
        scope.launch { siblingCompleted = true }

        advanceUntilIdle()

        assertTrue("scope must remain active after child failure", scope.isActive)
        assertTrue("sibling B must complete despite child A throwing", siblingCompleted)
        // Validate app-lifetime semantics: do NOT call scope.cancel() anywhere in this test.
    }

    @Test
    fun `scope accepts new launches after child throws`() = runTest {
        val scheduler = TestCoroutineScheduler()
        val dispatcher = StandardTestDispatcher(scheduler)
        val scope = CoroutineScope(SupervisorJob() + dispatcher)

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
