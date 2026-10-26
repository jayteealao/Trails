package com.jayteealao.trails.data.archive

import android.app.Application
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Verifies the one-shot shared-article read used for metadata and the screenshot
 * image: the shared id comes from the server-written `canonicalId` on
 * users/{uid}/articles/{itemId}, falls back to the itemId, and a denied read
 * returns null with one attempt and no write.
 *
 * Exercised via the public fetchWargMetadata(), which routes its read through
 * the private getSharedArticleDoc() helper.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK(relaxed = true) private lateinit var okHttpClient: OkHttpClient
    @MockK(relaxed = true) private lateinit var archiveUrlService: ArchiveUrlService
    @MockK(relaxed = true) private lateinit var remoteConfig: FirebaseRemoteConfig
    @MockK(relaxed = true) private lateinit var localArchiveDao: LocalArchiveDao
    @MockK(relaxed = true) private lateinit var articleDao: ArticleDao
    @MockK(relaxed = true) private lateinit var application: Application

    private lateinit var userArticleDoc: DocumentReference
    private lateinit var item1Doc: DocumentReference
    private lateinit var shared1Doc: DocumentReference
    private lateinit var service: ArchiveService

    private val denied = FirebaseFirestoreException(
        "permission denied",
        FirebaseFirestoreException.Code.PERMISSION_DENIED,
    )

    @Before
    fun setUp() {
        MockKAnnotations.init(this)

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        val usersCollection = mockk<CollectionReference>()
        val userDoc = mockk<DocumentReference>()
        val userArticles = mockk<CollectionReference>()
        userArticleDoc = mockk()
        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document("u1") } returns userDoc
        every { userDoc.collection("articles") } returns userArticles
        every { userArticles.document("item1") } returns userArticleDoc

        val articlesCollection = mockk<CollectionReference>()
        item1Doc = mockk()
        shared1Doc = mockk()
        every { firestore.collection("articles") } returns articlesCollection
        every { articlesCollection.document("item1") } returns item1Doc
        every { articlesCollection.document("shared1") } returns shared1Doc

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

    private fun metadataSnapshot(title: String): DocumentSnapshot {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.get("metadata") } returns mapOf("title" to title, "word_count" to 42L)
        return snapshot
    }

    @Test
    fun `reads the shared article named by canonicalId`() = runTest {
        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot("shared1"))
        every { shared1Doc.get() } returns Tasks.forResult(metadataSnapshot("Shared title"))

        val result = service.fetchWargMetadata("item1")

        assertEquals("Shared title", result?.title)
        assertEquals(42, result?.wordCount)
        verify(exactly = 1) { shared1Doc.get() }
        verify(exactly = 0) { item1Doc.get() }
    }

    @Test
    fun `reads by itemId when canonicalId is absent or the user doc read fails`() = runTest {
        every { item1Doc.get() } returns Tasks.forResult(metadataSnapshot("Own title"))

        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot(null))
        assertEquals("Own title", service.fetchWargMetadata("item1")?.title)

        every { userArticleDoc.get() } returns Tasks.forException(denied)
        assertEquals("Own title", service.fetchWargMetadata("item1")?.title)

        verify(exactly = 2) { item1Doc.get() }
        verify(exactly = 0) { shared1Doc.get() }
    }

    @Test
    fun `denied shared read returns null with one attempt and no write`() = runTest {
        every { userArticleDoc.get() } returns Tasks.forResult(userSnapshot("shared1"))
        every { shared1Doc.get() } returns Tasks.forException(denied)

        val result = service.fetchWargMetadata("item1")

        assertNull(result)
        verify(exactly = 1) { shared1Doc.get() }
        verify(exactly = 0) { userArticleDoc.set(any()) }
        verify(exactly = 0) { userArticleDoc.set(any(), any()) }
        verify(exactly = 0) { userArticleDoc.collection(any()) }
    }
}
