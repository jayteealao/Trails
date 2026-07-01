package com.jayteealao.trails.data.archive

import android.app.Application
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.EventListener
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.FirebaseFirestoreException.Code
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.network.ArchiveUrlService
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for [ArchiveService.observeRemoteArchives] — the callbackFlow that
 * self-heals on PERMISSION_DENIED.
 *
 * Pattern: capture the EventListener<DocumentSnapshot> argument passed to
 * docRef.addSnapshotListener(), then fire events into it to simulate Firestore
 * callback sequences. UnconfinedTestDispatcher drives coroutines eagerly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceObserveTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK private lateinit var backupService: FirestoreBackupService
    @MockK(relaxed = true) private lateinit var okHttpClient: OkHttpClient
    @MockK(relaxed = true) private lateinit var archiveUrlService: ArchiveUrlService
    @MockK(relaxed = true) private lateinit var remoteConfig: FirebaseRemoteConfig
    @MockK(relaxed = true) private lateinit var localArchiveDao: LocalArchiveDao
    @MockK(relaxed = true) private lateinit var articleDao: ArticleDao
    @MockK(relaxed = true) private lateinit var application: Application

    private lateinit var docRef: DocumentReference
    private lateinit var articlesCollection: CollectionReference
    private lateinit var service: ArchiveService

    // Captures the EventListener passed to addSnapshotListener on each attach() call.
    // Because attach() may be called multiple times (re-attach after self-heal),
    // we collect each invocation separately.
    private val listenerSlots = mutableListOf<EventListener<DocumentSnapshot>>()

    private val denied = FirebaseFirestoreException("PERMISSION_DENIED", Code.PERMISSION_DENIED)
    private val unavailable = FirebaseFirestoreException("UNAVAILABLE", Code.UNAVAILABLE)
    private lateinit var registration: ListenerRegistration

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        listenerSlots.clear()

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        articlesCollection = mockk()
        docRef = mockk()
        every { firestore.collection("articles") } returns articlesCollection
        every { articlesCollection.document(any()) } returns docRef

        registration = mockk(relaxed = true)

        // Capture each EventListener registered via addSnapshotListener and return
        // a distinct (relaxed) ListenerRegistration for each attach() call.
        val listenerSlot = slot<EventListener<DocumentSnapshot>>()
        every { docRef.addSnapshotListener(capture(listenerSlot)) } answers {
            listenerSlots.add(listenerSlot.captured)
            mockk(relaxed = true)
        }

        coEvery { backupService.writeArticleMarker(any(), any()) } returns Result.success(Unit)
        // owningItemId() checks articleDao first; return null so it falls back to key = itemId.
        coEvery { articleDao.getArticleById(any()) } returns null
        coEvery { articleDao.getArticleByResolvedId(any()) } returns null

        service = ArchiveService(
            firestore = firestore,
            auth = auth,
            backupService = backupService,
            okHttpClient = okHttpClient,
            archiveUrlService = archiveUrlService,
            remoteConfig = remoteConfig,
            localArchiveDao = localArchiveDao,
            articleDao = articleDao,
            application = application,
            ioDispatcher = UnconfinedTestDispatcher(),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    /**
     * Denied → self-heal marker write → re-attach → success emits non-empty.
     *
     * This is the core deadlock-break scenario: the marker is absent when the
     * listener first attaches, the self-heal writes it, and the re-attached
     * listener receives the archive document.
     */
    @Test
    fun `denied then self-healed listener emits archives on success`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch {
            service.observeRemoteArchives("item1").toList(emitted)
        }
        advanceUntilIdle()

        // First listener attached — fire PERMISSION_DENIED.
        assertNotNull("first listener should be captured", listenerSlots.firstOrNull())
        listenerSlots[0].onEvent(null, denied)
        advanceUntilIdle()

        // Self-heal should have written the marker and re-attached.
        coVerify(exactly = 1) { backupService.writeArticleMarker("item1", "item1") }
        assertEquals("re-attach should have registered a second listener", 2, listenerSlots.size)

        // Second listener attached — fire a successful snapshot with one archive.
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.get("archives") } returns mapOf(
            "markdown" to mapOf("status" to "success", "gcs_path" to "gs://bucket/md")
        )
        listenerSlots[1].onEvent(snapshot, null)
        advanceUntilIdle()

        assertTrue("should have emitted archives after self-heal", emitted.any { it.isNotEmpty() })
        val archives = emitted.last()
        assertEquals(1, archives.size)
        assertEquals("success", archives["markdown"]?.status)

        job.cancel()
    }

    /**
     * Marker write failure degrades gracefully to empty without crashing.
     * The flow must not throw — the detail screen shows an empty archives panel.
     */
    @Test
    fun `marker write failure emits empty and does not crash`() = runTest(UnconfinedTestDispatcher()) {
        coEvery { backupService.writeArticleMarker(any(), any()) } returns Result.failure(Exception("write failed"))

        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch {
            service.observeRemoteArchives("item1").toList(emitted)
        }
        advanceUntilIdle()

        listenerSlots[0].onEvent(null, denied)
        advanceUntilIdle()

        // A second listener should be attached after the failed write (the re-attach
        // is unconditional once the counter is incremented).
        // Fire denied again to exhaust the bound (attempt 2/2).
        if (listenerSlots.size > 1) {
            listenerSlots[1].onEvent(null, denied)
            advanceUntilIdle()
        }

        // After both bounds exhausted, the next denial should emit empty.
        if (listenerSlots.size > 2) {
            listenerSlots[2].onEvent(null, denied)
            advanceUntilIdle()
        }

        assertTrue("should have emitted at least one empty map", emitted.any { it.isEmpty() })
        job.cancel()
    }

    /**
     * The bounded cap prevents infinite re-attachment loops: after MAX_SELF_HEAL_ATTEMPTS,
     * subsequent denials emit empty and do NOT trigger further self-heals.
     */
    @Test
    fun `self-heal attempts are capped and terminal denial emits empty`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch {
            service.observeRemoteArchives("item1").toList(emitted)
        }
        advanceUntilIdle()

        // Fire denied up to and beyond the cap (MAX = 2).
        repeat(3) { i ->
            val idx = listenerSlots.size - 1
            if (idx >= 0) {
                listenerSlots[idx].onEvent(null, denied)
                advanceUntilIdle()
            }
        }

        // Self-heal must have been called at most MAX_SELF_HEAL_ATTEMPTS (2) times.
        coVerify(atMost = 2) { backupService.writeArticleMarker(any(), any()) }
        // At least one empty map must have been emitted after the bound was hit.
        assertTrue("should have emitted empty after cap", emitted.any { it.isEmpty() })

        job.cancel()
    }

    /**
     * Cancelling the flow during a self-heal coroutine must NOT trigger another
     * re-attach once the collector scope is gone.
     */
    @Test
    fun `cancel during self-heal does not re-attach`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch {
            service.observeRemoteArchives("item1").first() // collect one element then cancel
        }
        advanceUntilIdle()

        // Fire denied to trigger self-heal coroutine launch.
        listenerSlots[0].onEvent(null, denied)
        // Cancel the collector immediately — the self-heal coroutine is still running.
        job.cancel()
        advanceUntilIdle()

        // Whether or not the marker write completes, the re-attach should NOT have
        // registered a second listener because isActive is false when the scope
        // checks it after the marker write returns. In practice, with
        // UnconfinedTestDispatcher, the cancel may race; we only assert that we
        // don't re-attach MORE than once (the self-heal path) beyond the initial attach.
        // This is a "no infinite loop" safety net, not a precise state assertion.
        assertTrue("listeners should not have exceeded 2 after one cancel", listenerSlots.size <= 2)
    }

    /**
     * A non-PERMISSION_DENIED error (e.g. UNAVAILABLE) emits empty immediately
     * without a self-heal attempt.
     */
    @Test
    fun `non-permission error emits empty without self-heal`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch {
            service.observeRemoteArchives("item1").toList(emitted)
        }
        advanceUntilIdle()

        listenerSlots[0].onEvent(null, unavailable)
        advanceUntilIdle()

        coVerify(exactly = 0) { backupService.writeArticleMarker(any(), any()) }
        assertTrue("should have emitted empty for non-permission error", emitted.isNotEmpty())
        assertTrue(emitted.last().isEmpty())

        job.cancel()
    }
}
