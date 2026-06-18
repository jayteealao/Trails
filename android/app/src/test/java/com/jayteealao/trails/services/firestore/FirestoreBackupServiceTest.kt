package com.jayteealao.trails.services.firestore

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.AggregateQuery
import com.google.firebase.firestore.AggregateQuerySnapshot
import com.google.firebase.firestore.AggregateSource
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Verifies that backing up an article also writes its existence marker(s)
 * onto the same WriteBatch (so they commit atomically), keyed by itemId plus
 * resolvedId when distinct.
 *
 * The `characterization` tests at the bottom pin the CURRENT (pre-refactor)
 * behaviour of the batch/large-text/restore surfaces that the `firestore-io`,
 * `firestore-dedup` and `streaming-restore` slices will refactor. They assert
 * today's observable shape — including quirks (e.g. paginated restore folding
 * every page into one in-memory list) — so those refactors can be proven
 * behaviour-preserving. Do not "fix" behaviour here.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirestoreBackupServiceTest {

    @MockK private lateinit var firestore: FirebaseFirestore
    @MockK private lateinit var auth: FirebaseAuth
    @MockK(relaxed = true) private lateinit var batch: WriteBatch

    private lateinit var markersCollection: CollectionReference
    private lateinit var usersCollection: CollectionReference
    private lateinit var userDoc: DocumentReference
    private lateinit var articlesCollection: CollectionReference
    private lateinit var articleDoc: DocumentReference
    private lateinit var service: FirestoreBackupService

    @Before
    fun setUp() {
        MockKAnnotations.init(this)

        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        usersCollection = mockk()
        userDoc = mockk()
        markersCollection = mockk()
        articlesCollection = mockk()
        articleDoc = mockk(relaxed = true)

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
                match<Map<String, Any>> {
                    it["key"] == "item1" && it["source"] == "sync" && it["itemId"] == "item1"
                },
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
        // Both markers carry itemId = "item1" (the owning article's id).
        verify(exactly = 1) {
            batch.set(
                itemMarker,
                match<Map<String, Any>> { it["key"] == "item1" && it["itemId"] == "item1" },
                any(),
            )
        }
        verify(exactly = 1) {
            batch.set(
                resolvedMarker,
                match<Map<String, Any>> { it["key"] == "resolved1" && it["itemId"] == "item1" },
                any(),
            )
        }
        verify(exactly = 2) { batch.set(any(), match<Map<String, Any>> { it["source"] == "sync" }, any()) }
    }

    @Test
    fun `does not duplicate the marker when resolvedId equals itemId`() = runTest {
        every { markersCollection.document("item1") } returns mockk<DocumentReference>()

        val result = service.backupArticle(article("item1", "item1"))

        assertTrue(result.isSuccess)
        verify(exactly = 1) { markersCollection.document(any()) }
        verify(exactly = 1) {
            batch.set(
                any(),
                match<Map<String, Any>> { it["source"] == "sync" && it["itemId"] == "item1" },
                any(),
            )
        }
    }

    @Test
    fun `does not write a resolvedId marker when resolvedId is blank`() = runTest {
        every { markersCollection.document("item1") } returns mockk<DocumentReference>()

        val result = service.backupArticle(article("item1", "  "))

        assertTrue(result.isSuccess)
        verify(exactly = 1) { markersCollection.document(any()) }
        verify(exactly = 1) {
            batch.set(
                any(),
                match<Map<String, Any>> { it["source"] == "sync" && it["itemId"] == "item1" },
                any(),
            )
        }
    }

    /**
     * TST-04 — writeArticleMarker happy path: the marker doc is written under
     * users/{uid}/articleMarkers/{key} (owner's uid path) with source = "self-heal"
     * and itemId = key (default: key and itemId are the same for itemId-keyed markers).
     */
    @Test
    fun `writeArticleMarker writes marker under owner uid path with self-heal source`() = runTest {
        val markerDoc = mockk<DocumentReference>()
        every { markersCollection.document("key1") } returns markerDoc
        every { markerDoc.set(any(), any()) } returns Tasks.forResult(null)

        val result = service.writeArticleMarker("key1")

        assertTrue(result.isSuccess)
        // Must set on the doc under users/u1/articleMarkers/key1 with itemId = key1.
        verify(exactly = 1) {
            markerDoc.set(
                match<Map<String, Any>> {
                    it["key"] == "key1" && it["source"] == "self-heal" && it["itemId"] == "key1"
                },
                any(),
            )
        }
    }

    /**
     * writeArticleMarker with explicit itemId: for a resolvedId-keyed self-heal
     * the caller can pass the owning article's itemId separately.
     */
    @Test
    fun `writeArticleMarker with explicit itemId carries correct itemId in marker body`() = runTest {
        val markerDoc = mockk<DocumentReference>()
        every { markersCollection.document("resolved-key") } returns markerDoc
        every { markerDoc.set(any(), any()) } returns Tasks.forResult(null)

        val result = service.writeArticleMarker("resolved-key", itemId = "article-1")

        assertTrue(result.isSuccess)
        verify(exactly = 1) {
            markerDoc.set(
                match<Map<String, Any>> {
                    it["key"] == "resolved-key" && it["itemId"] == "article-1" && it["source"] == "self-heal"
                },
                any(),
            )
        }
    }

    /**
     * TST-04 — writeArticleMarker failure path: when Firestore throws, the
     * function returns a failed Result instead of propagating the exception.
     */
    @Test
    fun `writeArticleMarker returns failure result when Firestore set throws`() = runTest {
        val markerDoc = mockk<DocumentReference>()
        every { markersCollection.document("key1") } returns markerDoc
        every { markerDoc.set(any(), any()) } returns Tasks.forException(RuntimeException("network error"))

        val result = service.writeArticleMarker("key1")

        assertFalse(result.isSuccess)
        assertTrue(result.isFailure)
    }

    @Test
    fun `backupArticles bulk path writes sync markers for every article`() = runTest {
        val markerDoc1 = mockk<DocumentReference>()
        val markerDoc2 = mockk<DocumentReference>()
        every { markersCollection.document("a1") } returns markerDoc1
        every { markersCollection.document("a2") } returns markerDoc2

        val result = service.backupArticles(listOf(article("a1", null), article("a2", null)))

        assertTrue(result.isSuccess)
        verify(exactly = 1) {
            batch.set(
                markerDoc1,
                match<Map<String, Any>> { it["key"] == "a1" && it["source"] == "sync" && it["itemId"] == "a1" },
                any(),
            )
        }
        verify(exactly = 1) {
            batch.set(
                markerDoc2,
                match<Map<String, Any>> { it["key"] == "a2" && it["source"] == "sync" && it["itemId"] == "a2" },
                any(),
            )
        }
    }

    // ---------------------------------------------------------------------------
    // Characterization tests — pin current behaviour for the upcoming refactors.
    // ---------------------------------------------------------------------------

    /**
     * `backupArticlesPaginated` chunks writes at WRITE_BATCH_LIMIT (20). 45 articles
     * ⇒ ceil(45/20) = 3 batches, each committed once. `firestore-io`/`firestore-dedup`
     * must preserve the per-chunk batch boundary (the rules document-access budget).
     */
    @Test
    fun `backupArticlesPaginated chunks at WRITE_BATCH_LIMIT of 20`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val articles = (1..45).map { Article(itemId = "a$it") }

        val result = service.backupArticlesPaginated(articles)

        assertTrue(result.isSuccess)
        assertEquals(45, result.getOrNull())
        verify(exactly = 3) { firestore.batch() }
        verify(exactly = 3) { batch.commit() }
    }

    /**
     * Large article text (> 900KB) is split off into the `text/content`
     * subcollection and the article doc is saved with `text = null`. This is the
     * inline-vs-subcollection boundary `firestore-io` will touch.
     */
    @Test
    fun `backupArticlesPaginated stores large text in subcollection and nulls article text`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val textCollection = mockk<CollectionReference>()
        val textDoc = mockk<DocumentReference>()
        every { articleDoc.collection("text") } returns textCollection
        every { textCollection.document("content") } returns textDoc

        val bigText = "a".repeat(900_001) // > MAX_TEXT_SIZE (900_000 bytes ASCII)
        val article = Article(itemId = "big", text = bigText)

        val result = service.backupArticlesPaginated(listOf(article))

        assertTrue(result.isSuccess)
        // Text written to the subcollection content doc...
        verify(exactly = 1) {
            batch.set(textDoc, match<Map<String, Any>> { it["text"] == bigText }, any())
        }
        // ...and the article doc is saved with text stripped.
        verify(exactly = 1) {
            batch.set(articleDoc, match<Article> { it.itemId == "big" && it.text == null }, any())
        }
    }

    /**
     * Small text stays inline on the article doc; no `text` subcollection write.
     */
    @Test
    fun `backupArticlesPaginated keeps small text inline on the article doc`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val article = Article(itemId = "small", text = "short body")

        val result = service.backupArticlesPaginated(listOf(article))

        assertTrue(result.isSuccess)
        verify(exactly = 0) { articleDoc.collection("text") }
        verify(exactly = 1) {
            batch.set(articleDoc, match<Article> { it.itemId == "small" && it.text == "short body" }, any())
        }
    }

    /**
     * Restore is auth-guarded: with no signed-in user it returns a failed Result
     * carrying "User not authenticated" (never touches Firestore).
     */
    @Test
    fun `restoreAllArticlesPaginated returns failure when unauthenticated`() = runTest {
        every { auth.currentUser } returns null

        val result = service.restoreAllArticlesPaginated()

        assertTrue(result.isFailure)
        assertEquals("User not authenticated", result.exceptionOrNull()?.message)
    }

    /**
     * `isFirstSync` is true when the user doc has no `lastSyncTimestamp` field.
     */
    @Test
    fun `isFirstSync returns true when lastSyncTimestamp absent`() = runTest {
        val userSnapshot = mockk<DocumentSnapshot>()
        every { userDoc.get() } returns Tasks.forResult(userSnapshot)
        every { userSnapshot.exists() } returns true
        every { userSnapshot.contains("lastSyncTimestamp") } returns false

        val result = service.isFirstSync()

        assertTrue(result.isSuccess)
        assertEquals(true, result.getOrNull())
    }

    /**
     * `getLastSyncTimestamp` reads `lastSyncTimestamp` off the users/{uid} doc.
     */
    @Test
    fun `getLastSyncTimestamp reads lastSyncTimestamp from user doc`() = runTest {
        val userSnapshot = mockk<DocumentSnapshot>()
        every { userDoc.get() } returns Tasks.forResult(userSnapshot)
        every { userSnapshot.getLong("lastSyncTimestamp") } returns 12_345L

        val result = service.getLastSyncTimestamp()

        assertTrue(result.isSuccess)
        assertEquals(12_345L, result.getOrNull())
        verify(exactly = 1) { userDoc.get() }
    }

    /**
     * QUIRK (pre-refactor): `restoreAllArticlesPaginated` pages through Firestore but
     * folds every page into a single in-memory list before returning. Two pages of
     * 50 + 10 ⇒ all 60 articles held at once. `streaming-restore` will replace this
     * accumulation with per-page writes; this test pins the current OOM-prone shape.
     */
    @Test
    fun `restoreAllArticlesPaginated accumulates all pages into one list`() = runTest {
        // Total-count aggregation for progress reporting.
        val aggQuery = mockk<AggregateQuery>()
        val aggSnapshot = mockk<AggregateQuerySnapshot>()
        every { articlesCollection.count() } returns aggQuery
        every { aggQuery.get(AggregateSource.SERVER) } returns Tasks.forResult(aggSnapshot)
        every { aggSnapshot.count } returns 60L

        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        // Page 1: 50 docs (== page limit ⇒ keep paging).
        val page1Query = mockk<Query>()
        val page1 = mockk<QuerySnapshot>()
        val page1Docs = (1..50).map { i ->
            mockk<DocumentSnapshot>().also {
                every { it.toObject(Article::class.java) } returns Article(itemId = "p1_$i")
            }
        }
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns page1Docs
        every { page1Query.get() } returns Tasks.forResult(page1)

        // Page 2: 10 docs (< page limit ⇒ stop), reached via startAfter(lastDocOfPage1).
        val lastDocPage1 = page1Docs.last()
        val page2Query = mockk<Query>()
        val page2Limited = mockk<Query>()
        val page2 = mockk<QuerySnapshot>()
        val page2Docs = (1..10).map { i ->
            mockk<DocumentSnapshot>().also {
                every { it.toObject(Article::class.java) } returns Article(itemId = "p2_$i")
            }
        }
        every { orderedQuery.startAfter(lastDocPage1) } returns page2Query
        every { page2Query.limit(50L) } returns page2Limited
        every { page2.documents } returns page2Docs
        every { page2Limited.get() } returns Tasks.forResult(page2)

        val result = service.restoreAllArticlesPaginated()

        assertTrue(result.isSuccess)
        assertEquals(60, result.getOrNull()?.size)
    }
}
