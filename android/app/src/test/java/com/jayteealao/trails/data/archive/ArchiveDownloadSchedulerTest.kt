package com.jayteealao.trails.data.archive

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Leaving an article stops its heavy downloads and lets its text downloads run on. */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveDownloadSchedulerTest {

    @Test
    fun cancelHeavy_stopsTheHeavyDownloadsOfThatArticleOnly() = runTest {
        val scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))
        val scheduler = ArchiveDownloadScheduler(scope)
        var monolithStopped = false
        var otherMonolithStopped = false
        scheduler.start("a", ArchiveType.MONOLITH) {
            try { awaitCancellation() } finally { monolithStopped = true }
        }
        scheduler.start("a", ArchiveType.READABILITY) { awaitCancellation() }
        scheduler.start("b", ArchiveType.MONOLITH) {
            try { awaitCancellation() } finally { otherMonolithStopped = true }
        }
        advanceUntilIdle()

        scheduler.cancelHeavy("a")
        advanceUntilIdle()

        assertTrue(monolithStopped)
        assertFalse(otherMonolithStopped)
        assertEquals(mapOf("readability" to ArchiveDownload.DOWNLOADING), scheduler.observe("a").first())
        assertEquals(mapOf("monolith" to ArchiveDownload.DOWNLOADING), scheduler.observe("b").first())
        scope.cancel()
    }

    @Test
    fun aStoppedHeavyDownloadStartsAgainAtTheNextSync() = runTest {
        val scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))
        val scheduler = ArchiveDownloadScheduler(scope)
        var starts = 0
        repeat(2) {
            scheduler.start("a", ArchiveType.MONOLITH) { starts++; awaitCancellation() }
            advanceUntilIdle()
            scheduler.cancelHeavy("a")
            advanceUntilIdle()
        }

        assertEquals(2, starts)
        assertEquals(emptyMap<String, ArchiveDownload>(), scheduler.observe("a").first())
        scope.cancel()
    }
}
