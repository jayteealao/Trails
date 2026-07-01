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
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Verifies the read-path self-heal: a PERMISSION_DENIED on the top-level
 * articles/{itemId} read triggers a one-shot marker write + retry, retries at
 * most once, and never lets the exception escape (the archive UI must not crash).
 *
 * Exercised via the public fetchWargMetadata(), which routes its read through
 * the private getArticleDocWithSelfHeal() helper.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchiveServiceTest {

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

        val articlesCollection = mockk<CollectionReference>()
        docRef = mockk()
        every { firestore.collection("articles") } returns articlesCollection
        every { articlesCollection.document("item1") } returns docRef

        // Service now always calls writeArticleMarker(key, itemId) with both args explicit;
        // stub the two-arg form so the relaxed default (null) on articleDao causes owningItemId
        // to fall back to key, making key == itemId for standard itemId-keyed tests.
        coEvery { backupService.writeArticleMarker(any(), any()) } returns Result.success(Unit)
        // owningItemId() falls back to `key` when the DAO returns null for both lookups.
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

    @Test
    fun `self-heals once on PERMISSION_DENIED then retries the read`() = runTest {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns false
        every { docRef.get() } returnsMany listOf(Tasks.forException(denied), Tasks.forResult(snapshot))

        val result = service.fetchWargMetadata("item1")

        // Doc absent after the retry → graceful null, no exception escapes.
        // articleDao is relaxed so owningItemId("item1") falls back to "item1";
        // both key and itemId are "item1" for standard itemId-keyed articles.
        assertNull(result)
        coVerify(exactly = 1) { backupService.writeArticleMarker("item1", "item1") }
        verify(exactly = 2) { docRef.get() }
    }

    @Test
    fun `retries at most once and never crashes on repeated denial`() = runTest {
        every { docRef.get() } returns Tasks.forException(denied)

        val result = service.fetchWargMetadata("item1")

        assertNull(result)
        coVerify(exactly = 1) { backupService.writeArticleMarker("item1", "item1") }
        verify(exactly = 2) { docRef.get() }
    }

    /**
     * TST-03 — ownership scoping: the self-heal writes the marker keyed by the
     * article's own itemId (not any other id), and the call is delegated entirely
     * to backupService (which routes under users/{uid}/articleMarkers/{key}).
     * A second article's self-heal must NOT write a marker for the first article's
     * key, confirming per-item isolation.
     */
    @Test
    fun `self-heal marker is written only for the denied item, not for other items`() = runTest {
        // Set up a second document reference for "item2".
        val articlesCollection = mockk<CollectionReference>()
        val docRef2 = mockk<DocumentReference>()
        every { firestore.collection("articles") } returns articlesCollection
        every { articlesCollection.document("item1") } returns docRef
        every { articlesCollection.document("item2") } returns docRef2

        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns false
        // item1: denied then succeeds; item2: immediately succeeds (no denial).
        every { docRef.get() } returnsMany listOf(Tasks.forException(denied), Tasks.forResult(snapshot))
        every { docRef2.get() } returns Tasks.forResult(snapshot)

        service.fetchWargMetadata("item1")
        service.fetchWargMetadata("item2")

        // Self-heal must have been invoked exactly once, and only for item1.
        // owningItemId falls back to the key for both items (relaxed articleDao → null).
        coVerify(exactly = 1) { backupService.writeArticleMarker("item1", "item1") }
        coVerify(exactly = 0) { backupService.writeArticleMarker("item2", any()) }
    }
}
