package com.jayteealao.trails.data.archive

import android.app.Application
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.jayteealao.trails.data.local.LocalFolders
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArchiveUrlService
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.spyk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/**
 * Each archive of an article downloads and is stored on its own: a heavy download
 * that never ends or fails does not hold back the text archive, and a failed one is
 * marked and tried again at the next sync.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceSyncTest {

    @get:Rule val tmp = TemporaryFolder()

    private val dao = FakeLocalArchiveDao()
    private val text = "# A title\n\nA paragraph.".toByteArray(Charsets.UTF_8)

    private fun ready(vararg keys: String): Map<String, ArchiveStatus> =
        keys.associateWithTo(linkedMapOf()) { ArchiveStatus("success", "gs://bucket/item1/$it") }

    private fun file(key: String) = File(tmp.root, "${LocalFolders.ARCHIVES_DIR}/item1/$key.gz")

    /** Stand-in application scopes; cancelled after each test, so a download that never ends stops. */
    private val appScopes = mutableListOf<CoroutineScope>()

    @After
    fun tearDown() {
        appScopes.forEach { it.cancel() }
    }

    // Not runTest's backgroundScope: advanceUntilIdle() does not run background work.
    private fun TestScope.appScope() =
        CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler)).also { appScopes += it }

    private fun TestScope.service(appScope: CoroutineScope = appScope()): ArchiveService {
        val application = mockk<Application>(relaxed = true)
        every { application.filesDir } returns tmp.root
        return spyk(
            ArchiveService(
                firestore = mockk<FirebaseFirestore>(relaxed = true),
                auth = mockk<FirebaseAuth>(relaxed = true),
                okHttpClient = OkHttpClient(),
                archiveUrlService = mockk<ArchiveUrlService>(relaxed = true),
                remoteConfig = mockk<FirebaseRemoteConfig>(relaxed = true),
                localArchiveDao = dao,
                articleDao = mockk<ArticleDao>(relaxed = true),
                application = application,
                ioDispatcher = StandardTestDispatcher(testScheduler),
                appScope = appScope,
            ),
        )
    }

    private fun ArchiveService.neverEnds(vararg keys: String) {
        keys.forEach { coEvery { downloadArchive("item1", it) } coAnswers { awaitCancellation() } }
    }

    private fun ArchiveService.returnsText(vararg keys: String) {
        keys.forEach { coEvery { downloadArchive("item1", it) } returns text }
    }

    @Test
    fun `the text archive is stored while every heavy download is still running`() = runTest {
        val service = service()
        service.neverEnds("singlefile", "monolith", "rendered")
        service.returnsText("readability")

        service.syncArchives("item1", ready("singlefile", "monolith", "rendered", "readability"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "readability"))
        assertTrue(file("readability").exists())
        assertEquals(
            mapOf(
                "singlefile" to ArchiveDownload.DOWNLOADING,
                "monolith" to ArchiveDownload.DOWNLOADING,
                "rendered" to ArchiveDownload.DOWNLOADING,
            ),
            service.observeDownloads("item1").first(),
        )
    }

    @Test
    fun `a later sync stores the text while a heavy download from an earlier sync runs`() = runTest {
        val service = service()
        service.neverEnds("monolith")
        service.returnsText("readability")

        service.syncArchives("item1", ready("monolith"))
        advanceUntilIdle()
        service.syncArchives("item1", ready("monolith", "readability"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "readability"))
        coVerify(exactly = 1) { service.downloadArchive("item1", "monolith") }
    }

    @Test
    fun `a heavy download that returns nothing is marked failed and the text stays`() = runTest {
        val service = service()
        coEvery { service.downloadArchive("item1", "monolith") } returns null
        service.returnsText("readability")

        service.syncArchives("item1", ready("monolith", "readability"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "readability"))
        assertTrue(file("readability").exists())
        assertNull(dao.getArchive("item1", "monolith"))
        assertEquals(mapOf("monolith" to ArchiveDownload.FAILED), service.observeDownloads("item1").first())
    }

    @Test
    fun `a heavy download that throws is marked failed and the text stays`() = runTest {
        val service = service()
        coEvery { service.downloadArchive("item1", "monolith") } throws IOException("connection reset")
        service.returnsText("readability")

        service.syncArchives("item1", ready("monolith", "readability"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "readability"))
        assertTrue(file("readability").exists())
        assertNull(dao.getArchive("item1", "monolith"))
        assertEquals(mapOf("monolith" to ArchiveDownload.FAILED), service.observeDownloads("item1").first())
    }

    @Test
    fun `a failed archive is tried again at the next sync`() = runTest {
        val service = service()
        coEvery { service.downloadArchive("item1", "monolith") } returnsMany listOf(null, "<html></html>".toByteArray())
        service.returnsText("readability")

        service.syncArchives("item1", ready("monolith", "readability"))
        advanceUntilIdle()
        service.syncArchives("item1", ready("monolith", "readability"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "monolith"))
        assertEquals(emptyMap<String, ArchiveDownload>(), service.observeDownloads("item1").first())
        coVerify(exactly = 2) { service.downloadArchive("item1", "monolith") }
    }

    @Test
    fun `two text archives that arrive together are both stored`() = runTest {
        val service = service()
        service.returnsText("readability", "markdown")

        service.syncArchives("item1", ready("readability", "markdown"))
        advanceUntilIdle()

        assertNotNull(dao.getArchive("item1", "readability"))
        assertNotNull(dao.getArchive("item1", "markdown"))
        assertEquals(2, dao.getArchivesForArticle("item1").size)
    }

    @Test
    fun `an archive already on disk is not downloaded again`() = runTest {
        val service = service()
        file("readability").apply { parentFile!!.mkdirs(); writeBytes(text) }
        dao.upsert(LocalArchive("item1", "readability", "archives/item1/readability.gz", 1, 1, 1))

        service.syncArchives("item1", ready("readability"))
        advanceUntilIdle()

        coVerify(exactly = 0) { service.downloadArchive(any(), any()) }
    }

    @Test
    fun `stopping the app during a download marks nothing failed`() = runTest {
        val appScope = appScope()
        val service = service(appScope)
        service.neverEnds("monolith")

        service.syncArchives("item1", ready("monolith"))
        advanceUntilIdle()
        assertEquals(mapOf("monolith" to ArchiveDownload.DOWNLOADING), service.observeDownloads("item1").first())

        appScope.cancel()
        advanceUntilIdle()

        assertEquals(emptyMap<String, ArchiveDownload>(), service.observeDownloads("item1").first())
    }
}
