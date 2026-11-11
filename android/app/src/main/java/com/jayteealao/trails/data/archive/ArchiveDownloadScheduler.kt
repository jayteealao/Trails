package com.jayteealao.trails.data.archive

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import timber.log.Timber

/** State of an archive download on this device; a stored archive has none. */
enum class ArchiveDownload { DOWNLOADING, FAILED }

/**
 * Runs the archive downloads of the app and keeps their state. Each archive downloads on its
 * own in [scope], so a text archive never waits for a heavy one: text archives and heavy
 * archives have their own permits.
 */
class ArchiveDownloadScheduler(private val scope: CoroutineScope) {
    /** Permits of the text archives, apart from the heavy ones: a text download never waits for a heavy one. */
    private val textPermits = Semaphore(2)

    /** Permits of the heavy archives; the cap bounds peak memory from parallel decompress. */
    private val heavyPermits = Semaphore(3)

    /** Per article, the archives whose download is running or failed, by archive key. */
    private val downloads = MutableStateFlow<Map<String, Map<String, ArchiveDownload>>>(emptyMap())

    /** Per article, the running heavy downloads by archive key, so leaving the article can stop them. */
    private val heavyJobs = mutableMapOf<String, MutableMap<String, Job>>()

    /**
     * Mark [type] of [itemId] as downloading and launch its download, unless it is already
     * downloading (so two syncs never fetch one archive twice). The job stores the archive and
     * clears its mark, marks it failed when the download gives nothing or throws, and clears the
     * mark when it is cancelled. [download] fetches and stores the archive and returns null when
     * it got nothing.
     */
    fun start(itemId: String, type: ArchiveType, download: suspend () -> Any?) {
        val key = type.archiveKey
        var start = false
        downloads.update { all ->
            val current = all[itemId].orEmpty()
            start = current[key] != ArchiveDownload.DOWNLOADING
            if (start) all + (itemId to current + (key to ArchiveDownload.DOWNLOADING)) else all
        }
        if (!start) {
            Timber.d("syncArchives($itemId) — skip $key (already downloading)")
            return
        }
        Timber.d("syncArchives($itemId) — starting download for $key")
        val permits = if (type.providesText) textPermits else heavyPermits
        val job = scope.launch {
            val stored = try {
                permits.withPermit { download() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Failed to download $key for $itemId")
                null
            }
            set(itemId, key, if (stored == null) ArchiveDownload.FAILED else null)
        }
        if (!type.providesText) synchronized(heavyJobs) { heavyJobs.getOrPut(itemId) { mutableMapOf() }[key] = job }
        job.invokeOnCompletion { cause ->
            if (!type.providesText) synchronized(heavyJobs) {
                heavyJobs[itemId]?.let { jobs -> if (jobs[key] === job) jobs -= key; if (jobs.isEmpty()) heavyJobs -= itemId }
            }
            if (cause != null) set(itemId, key, null)
        }
    }

    /**
     * Stops the heavy downloads of [itemId] (SingleFile, Monolith, the rendered page, the PDF and
     * the screenshot) when the person leaves the article; a text download runs on, so the text is
     * there at the next open. A stopped archive downloads again at the next sync.
     */
    fun cancelHeavy(itemId: String) {
        val jobs = synchronized(heavyJobs) { heavyJobs.remove(itemId)?.values?.toList().orEmpty() }
        jobs.forEach { it.cancel() }
    }

    private fun set(itemId: String, key: String, state: ArchiveDownload?) {
        downloads.update { all ->
            val current = all[itemId].orEmpty()
            val next = if (state == null) current - key else current + (key to state)
            if (next.isEmpty()) all - itemId else all + (itemId to next)
        }
    }

    /** Downloads of [itemId] that are running or failed, by archive key. A stored archive is absent. */
    fun observe(itemId: String): Flow<Map<String, ArchiveDownload>> =
        downloads.map { it[itemId].orEmpty() }.distinctUntilChanged()
}
