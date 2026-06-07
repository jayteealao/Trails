package com.jayteealao.trails.services.firestore

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.WriteBatch
import com.jayteealao.trails.data.local.database.Article
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Verifies that backing up an article also writes its existence marker(s)
 * onto the same WriteBatch (so they commit atomically), keyed by itemId plus
 * resolvedId when distinct.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirestoreBackupServiceTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK(relaxed = true) private lateinit var batch: WriteBatch

    private lateinit var markersCollection: CollectionReference
    private lateinit var service: FirestoreBackupService

    @Before
    fun setUp() {
        MockKAnnotations.init(this)

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        val usersCollection = mockk<CollectionReference>()
        val userDoc = mockk<DocumentReference>()
        markersCollection = mockk()
        val articlesCollection = mockk<CollectionReference>()
        val articleDoc = mockk<DocumentReference>(relaxed = true)

        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document("u1") } returns userDoc
        every { userDoc.collection("articleMarkers") } returns markersCollection
        every { userDoc.collection("articles") } returns articlesCollection
        every { articlesCollection.document(any()) } returns articleDoc

        every { firestore.batch() } returns batch
        every { batch.commit() } returns Tasks.forResult(null)

        service = FirestoreBackupService(firestore, auth)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    private fun article(id: String, resolved: String?): Article {
        val a = mockk<Article>(relaxed = true)
        every { a.itemId } returns id
        every { a.resolvedId } returns resolved
        every { a.text } returns null
        return a
    }

    @Test
    fun `writes a single sync marker for itemId when resolvedId is null`() = runTest {
        val markerDoc = mockk<DocumentReference>()
        every { markersCollection.document("item1") } returns markerDoc

        val result = service.backupArticle(article("item1", null))

        assertTrue(result.isSuccess)
        verify(exactly = 1) {
            batch.set(
                markerDoc,
                match<Map<String, Any>> { it["key"] == "item1" && it["source"] == "sync" },
                any(),
            )
        }
        // Only one marker doc requested → no spurious resolvedId marker.
        verify(exactly = 1) { markersCollection.document(any()) }
    }

    @Test
    fun `writes markers for both itemId and a distinct resolvedId`() = runTest {
        val itemMarker = mockk<DocumentReference>()
        val resolvedMarker = mockk<DocumentReference>()
        every { markersCollection.document("item1") } returns itemMarker
        every { markersCollection.document("resolved1") } returns resolvedMarker

        val result = service.backupArticle(article("item1", "resolved1"))

        assertTrue(result.isSuccess)
        verify(exactly = 1) { batch.set(itemMarker, match<Map<String, Any>> { it["key"] == "item1" }, any()) }
        verify(exactly = 1) { batch.set(resolvedMarker, match<Map<String, Any>> { it["key"] == "resolved1" }, any()) }
        verify(exactly = 2) { batch.set(any(), match<Map<String, Any>> { it["source"] == "sync" }, any()) }
    }

    @Test
    fun `does not duplicate the marker when resolvedId equals itemId`() = runTest {
        every { markersCollection.document("item1") } returns mockk<DocumentReference>()

        val result = service.backupArticle(article("item1", "item1"))

        assertTrue(result.isSuccess)
        verify(exactly = 1) { markersCollection.document(any()) }
        verify(exactly = 1) { batch.set(any(), match<Map<String, Any>> { it["source"] == "sync" }, any()) }
    }

    @Test
    fun `does not write a resolvedId marker when resolvedId is blank`() = runTest {
        every { markersCollection.document("item1") } returns mockk<DocumentReference>()

        val result = service.backupArticle(article("item1", "  "))

        assertTrue(result.isSuccess)
        verify(exactly = 1) { markersCollection.document(any()) }
        verify(exactly = 1) { batch.set(any(), match<Map<String, Any>> { it["source"] == "sync" }, any()) }
    }
}
