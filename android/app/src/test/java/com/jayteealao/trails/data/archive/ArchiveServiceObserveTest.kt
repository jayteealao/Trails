package com.jayteealao.trails.data.archive

import android.app.Application
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
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for [ArchiveService.observeRemoteArchives]: the archive view follows
 * the server-written `canonicalId` on users/{uid}/articles/{itemId}, falls back to
 * the user's own itemId, and degrades to an empty map on any read error without
 * writing anything.
 *
 * Pattern: every addSnapshotListener call is recorded with its EventListener and a
 * distinct ListenerRegistration, then events are fired into the listeners.
 * Document references are strict mocks, so an unexpected write call fails the test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceObserveTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK(relaxed = true) private lateinit var okHttpClient: OkHttpClient
    @MockK(relaxed = true) private lateinit var archiveUrlService: ArchiveUrlService
    @MockK(relaxed = true) private lateinit var remoteConfig: FirebaseRemoteConfig
    @MockK(relaxed = true) private lateinit var localArchiveDao: LocalArchiveDao
    @MockK(relaxed = true) private lateinit var articleDao: ArticleDao
    @MockK(relaxed = true) private lateinit var application: Application

    private lateinit var userArticleDoc: DocumentReference
    private lateinit var service: ArchiveService

    /** Listeners on the user's own article doc, in attach order. */
    private val userListeners = mutableListOf<EventListener<DocumentSnapshot>>()
    private val userRegistrations = mutableListOf<ListenerRegistration>()

    /** Listeners on shared article docs, as (shared id, listener), in attach order. */
    private val sharedListeners = mutableListOf<Pair<String, EventListener<DocumentSnapshot>>>()
    private val sharedRegistrations = mutableMapOf<String, MutableList<ListenerRegistration>>()

    private val denied = FirebaseFirestoreException("PERMISSION_DENIED", Code.PERMISSION_DENIED)
    private val unavailable = FirebaseFirestoreException("UNAVAILABLE", Code.UNAVAILABLE)

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        userListeners.clear()
        userRegistrations.clear()
        sharedListeners.clear()
        sharedRegistrations.clear()

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        // users/u1/articles/{itemId}
        val usersCollection = mockk<CollectionReference>()
        val userDoc = mockk<DocumentReference>()
        val userArticles = mockk<CollectionReference>()
        userArticleDoc = mockk()
        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document("u1") } returns userDoc
        every { userDoc.collection("articles") } returns userArticles
        every { userArticles.document(any()) } returns userArticleDoc
        every { userArticleDoc.addSnapshotListener(any<EventListener<DocumentSnapshot>>()) } answers {
            userListeners += firstArg<EventListener<DocumentSnapshot>>()
            mockk<ListenerRegistration>(relaxed = true).also { userRegistrations += it }
        }

        // articles/{sharedId}
        val articlesCollection = mockk<CollectionReference>()
        every { firestore.collection("articles") } returns articlesCollection
        for (id in listOf("item1", "shared1")) {
            val ref = mockk<DocumentReference>()
            every { ref.addSnapshotListener(any<EventListener<DocumentSnapshot>>()) } answers {
                sharedListeners += id to firstArg<EventListener<DocumentSnapshot>>()
                mockk<ListenerRegistration>(relaxed = true).also {
                    sharedRegistrations.getOrPut(id) { mutableListOf() } += it
                }
            }
            every { articlesCollection.document(id) } returns ref
        }

        service = ArchiveService(
            firestore = firestore,
            auth = auth,
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

    private fun userSnapshot(canonicalId: String?): DocumentSnapshot {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.get("canonicalId") } returns canonicalId
        return snapshot
    }

    private fun archiveSnapshot(key: String, status: String): DocumentSnapshot {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.get("archives") } returns mapOf(
            key to mapOf("status" to status, "gcs_path" to "gs://bucket/$key")
        )
        return snapshot
    }

    private fun sharedIdsAttached() = sharedListeners.map { it.first }

    @Test
    fun `canonicalId different from itemId attaches to the shared article and emits its archives`() =
        runTest(UnconfinedTestDispatcher()) {
            val emitted = mutableListOf<Map<String, ArchiveStatus>>()
            val job = launch { service.observeRemoteArchives("item1").toList(emitted) }
            advanceUntilIdle()

            userListeners.single().onEvent(userSnapshot("shared1"), null)
            advanceUntilIdle()
            assertEquals(listOf("shared1"), sharedIdsAttached())

            sharedListeners.single().second.onEvent(archiveSnapshot("readability", "success"), null)
            advanceUntilIdle()

            assertEquals(1, emitted.last().size)
            assertEquals("success", emitted.last()["readability"]?.status)
            job.cancel()
        }

    @Test
    fun `no canonicalId falls back to the own itemId`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch { service.observeRemoteArchives("item1").toList(emitted) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot(null), null)
        advanceUntilIdle()
        assertEquals(listOf("item1"), sharedIdsAttached())

        sharedListeners.single().second.onEvent(archiveSnapshot("markdown", "success"), null)
        advanceUntilIdle()
        assertEquals("success", emitted.last()["markdown"]?.status)
        job.cancel()
    }

    @Test
    fun `blank canonicalId falls back to itemId`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch { service.observeRemoteArchives("item1").toList(mutableListOf()) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot("  "), null)
        advanceUntilIdle()

        assertEquals(listOf("item1"), sharedIdsAttached())
        job.cancel()
    }

    @Test
    fun `user doc listener error falls back to itemId`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch { service.observeRemoteArchives("item1").toList(mutableListOf()) }
        advanceUntilIdle()

        userListeners.single().onEvent(null, denied)
        advanceUntilIdle()

        assertEquals(listOf("item1"), sharedIdsAttached())
        job.cancel()
    }

    @Test
    fun `canonicalId written while the view is open moves the listener to the shared article`() =
        runTest(UnconfinedTestDispatcher()) {
            val emitted = mutableListOf<Map<String, ArchiveStatus>>()
            val job = launch { service.observeRemoteArchives("item1").toList(emitted) }
            advanceUntilIdle()

            userListeners.single().onEvent(userSnapshot(null), null)
            advanceUntilIdle()
            sharedListeners.single().second.onEvent(null, denied)
            advanceUntilIdle()
            assertTrue(emitted.last().isEmpty())

            // The server writes canonicalId; the view follows it with no restart.
            userListeners.single().onEvent(userSnapshot("shared1"), null)
            advanceUntilIdle()

            assertEquals(listOf("item1", "shared1"), sharedIdsAttached())
            verify(exactly = 1) { sharedRegistrations.getValue("item1").single().remove() }

            sharedListeners.last().second.onEvent(archiveSnapshot("readability", "success"), null)
            advanceUntilIdle()
            assertEquals("success", emitted.last()["readability"]?.status)
            job.cancel()
        }

    @Test
    fun `canonicalId appearing with the itemId value re-subscribes`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch { service.observeRemoteArchives("item1").toList(mutableListOf()) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot(null), null)
        advanceUntilIdle()
        userListeners.single().onEvent(userSnapshot("item1"), null)
        advanceUntilIdle()

        assertEquals(listOf("item1", "item1"), sharedIdsAttached())
        job.cancel()
    }

    @Test
    fun `unchanged canonicalId does not re-subscribe`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch { service.observeRemoteArchives("item1").toList(mutableListOf()) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot("shared1"), null)
        advanceUntilIdle()
        userListeners.single().onEvent(userSnapshot("shared1"), null)
        advanceUntilIdle()

        assertEquals(listOf("shared1"), sharedIdsAttached())
        job.cancel()
    }

    @Test
    fun `denied shared read emits empty, writes nothing and does not retry`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch { service.observeRemoteArchives("item1").toList(emitted) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot("shared1"), null)
        advanceUntilIdle()
        sharedListeners.single().second.onEvent(null, denied)
        advanceUntilIdle()

        assertTrue(emitted.isNotEmpty())
        assertTrue(emitted.last().isEmpty())
        // One attach only: no re-attach after the denial.
        assertEquals(listOf("shared1"), sharedIdsAttached())
        // The user doc is never written and no subcollection (marker path) is touched.
        verify(exactly = 0) { userArticleDoc.set(any()) }
        verify(exactly = 0) { userArticleDoc.set(any(), any()) }
        verify(exactly = 0) { userArticleDoc.collection(any()) }
        job.cancel()
    }

    @Test
    fun `non-permission error emits empty`() = runTest(UnconfinedTestDispatcher()) {
        val emitted = mutableListOf<Map<String, ArchiveStatus>>()
        val job = launch { service.observeRemoteArchives("item1").toList(emitted) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot("shared1"), null)
        advanceUntilIdle()
        sharedListeners.single().second.onEvent(null, unavailable)
        advanceUntilIdle()

        assertTrue(emitted.last().isEmpty())
        assertEquals(1, sharedListeners.size)
        job.cancel()
    }

    @Test
    fun `cancelling removes both listener registrations`() = runTest(UnconfinedTestDispatcher()) {
        val job = launch { service.observeRemoteArchives("item1").toList(mutableListOf()) }
        advanceUntilIdle()

        userListeners.single().onEvent(userSnapshot("shared1"), null)
        advanceUntilIdle()

        job.cancel()
        advanceUntilIdle()

        verify(exactly = 1) { userRegistrations.single().remove() }
        verify(exactly = 1) { sharedRegistrations.getValue("shared1").single().remove() }
    }
}
