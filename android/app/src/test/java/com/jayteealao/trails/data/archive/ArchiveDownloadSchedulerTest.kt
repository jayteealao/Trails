package com.jayteealao.trails.data.archive

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArchiveDownloadSchedulerTest {

    @Test
    fun cancelAll_stopsEveryRunningDownload_andClearsItsState() = runTest {
        val scheduler = ArchiveDownloadScheduler(backgroundScope)
        val started = CompletableDeferred<Unit>()
        val stopped = CompletableDeferred<Unit>()
        val text = ArchiveType.entries.first { it.providesText }
        scheduler.start("a1", text) {
            started.complete(Unit)
            try {
                awaitCancellation()
            } finally {
                stopped.complete(Unit)
            }
        }
        started.await()
        assertEquals(mapOf(text.archiveKey to ArchiveDownload.DOWNLOADING), scheduler.observe("a1").first())

        scheduler.cancelAll()

        assertTrue(stopped.isCompleted)
        assertEquals(emptyMap<String, ArchiveDownload>(), scheduler.observe("a1").first())
    }
}
