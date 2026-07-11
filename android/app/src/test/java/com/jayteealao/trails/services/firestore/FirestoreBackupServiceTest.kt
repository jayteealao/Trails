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
import com.jayteealao.trails.network.ArticleTags
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.coVerify
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Verifies that backing up an article also writes its existence marker(s)
 * onto the same WriteBatch (so they commit atomically), keyed by itemId plus
 * resolvedId when distinct.
 *
 * The `characterization` tests at the bottom pin the behaviour of the
 * batch/large-text/restore surfaces. The streaming-restore slice updated
 * [FirestoreBackupService.restoreAllArticlesPaginated] to deliver articles
 * per-page via [onPage] callback rather than accumulating a full list. Tests
 * below verify the new streaming shape and the A2b rehydration path.
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
    // Characterization tests — pin behaviour for the backup and restore surfaces.
    // ---------------------------------------------------------------------------

    /**
     * `backupArticlesPaginated` caps each batch at WRITE_BATCH_LIMIT (20) articles to
     * honour the Firestore rules getAfter budget, regardless of total write count.
     * 45 plain articles (no tags, null resolvedId) contribute 2 writes each (article
     * doc + 1 marker) = 90 total writes — well under the 500-write threshold — but
     * the 20-article cap forces 3 batches: articles 1–20, 21–40, 41–45.
     */
    @Test
    fun `backupArticlesPaginated chunks at WRITE_BATCH_LIMIT of 20`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val articles = (1..45).map { Article(itemId = "a$it") }

        // Use a fresh mock per batch.commit() call so we can count commits.
        val batch1 = mockk<WriteBatch>(relaxed = true)
        val batch2 = mockk<WriteBatch>(relaxed = true)
        val batch3 = mockk<WriteBatch>(relaxed = true)
        every { firestore.batch() } returnsMany listOf(batch1, batch2, batch3)
        every { batch1.commit() } returns Tasks.forResult(null)
        every { batch2.commit() } returns Tasks.forResult(null)
        every { batch3.commit() } returns Tasks.forResult(null)

        val result = service.backupArticlesPaginated(articles)

        assertTrue(result.isSuccess)
        assertEquals(45, result.getOrNull())
        // 45 articles capped at 20 per batch → 3 batches (20 + 20 + 5).
        verify(exactly = 3) { firestore.batch() }
        verify(exactly = 1) { batch1.commit() }
        verify(exactly = 1) { batch2.commit() }
        verify(exactly = 1) { batch3.commit() }
    }

    /**
     * Companion test for the article-count cap: a list of 25 articles with tiny
     * write footprints (no tags, small text — 2 writes each, total 50 writes —
     * well under the 500-write threshold) must still be committed in 2 batches
     * because the WRITE_BATCH_LIMIT (20 articles per batch) is hit first.
     * No single batch should receive more than 20 articles.
     */
    @Test
    fun `backupArticlesPaginated caps batches at 20 articles even when write count is low`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val articles = (1..25).map { Article(itemId = "c$it") }

        // Use a fresh mock per batch so we can verify each is committed exactly once.
        val batch1 = mockk<WriteBatch>(relaxed = true)
        val batch2 = mockk<WriteBatch>(relaxed = true)
        every { firestore.batch() } returnsMany listOf(batch1, batch2)
        every { batch1.commit() } returns Tasks.forResult(null)
        every { batch2.commit() } returns Tasks.forResult(null)

        val result = service.backupArticlesPaginated(articles)

        assertTrue(result.isSuccess)
        assertEquals(25, result.getOrNull())
        // 25 articles at 20 per batch → 2 batches (20 + 5), not 1.
        verify(exactly = 2) { firestore.batch() }
        verify(exactly = 1) { batch1.commit() }
        verify(exactly = 1) { batch2.commit() }
    }

    /**
     * `backupArticlesPaginated` splits into multiple batches when the per-article
     * write count would push the running total past the 500-write threshold.
     *
     * Setup: 3 articles each carrying 250 tags → 252 writes per article
     * (1 article doc + 250 tag docs + 1 marker).
     * - Batch 1: article 1 (252). Before article 2: 252+252=504 > 500 → flush.
     * - Batch 2: article 2 (252). Before article 3: 252+252=504 > 500 → flush.
     * - Batch 3: article 3 (252). End of list → flush.
     * Result: 3 batches committed.
     */
    @Test
    fun `backupArticlesPaginated flushes when next article would exceed write-count threshold`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)

        // Wire tag doc refs for each article.
        val tagsCollection = mockk<CollectionReference>()
        every { articleDoc.collection("tags") } returns tagsCollection
        every { tagsCollection.document(any()) } returns mockk(relaxed = true)

        val tagCount = 250
        val tagsByArticleId = (1..3).associate { i ->
            "a$i" to (1..tagCount).map { t ->
                ArticleTags(itemId = "a$i", tag = "tag$t", sortId = null, type = null)
            }
        }
        val articles = (1..3).map { Article(itemId = "a$it") }

        // Use a fresh mock per batch.commit() call so we can count commits.
        val batch1 = mockk<WriteBatch>(relaxed = true)
        val batch2 = mockk<WriteBatch>(relaxed = true)
        val batch3 = mockk<WriteBatch>(relaxed = true)
        every { firestore.batch() } returnsMany listOf(batch1, batch2, batch3)
        every { batch1.commit() } returns Tasks.forResult(null)
        every { batch2.commit() } returns Tasks.forResult(null)
        every { batch3.commit() } returns Tasks.forResult(null)

        val result = service.backupArticlesPaginated(
            articles = articles,
            tagsByArticleId = tagsByArticleId
        )

        assertTrue(result.isSuccess)
        assertEquals(3, result.getOrNull())
        verify(exactly = 3) { firestore.batch() }
        verify(exactly = 1) { batch1.commit() }
        verify(exactly = 1) { batch2.commit() }
        verify(exactly = 1) { batch3.commit() }
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

    // ---------------------------------------------------------------------------
    // B2 efficiency-1 tests (firestore-io slice): getUserMetaSnapshot single read
    // ---------------------------------------------------------------------------

    /**
     * B2 efficiency-1 — Happy path: [getUserMetaSnapshot] reads users/{uid} exactly
     * once and extracts both [isFirstSync] and [lastSyncTimestamp] from the same doc.
     */
    @Test
    fun `getUserMetaSnapshot reads users doc exactly once for isFirstSync and lastSyncTimestamp`() = runTest {
        val userSnapshot = mockk<DocumentSnapshot>()
        every { userDoc.get() } returns Tasks.forResult(userSnapshot)
        every { userSnapshot.exists() } returns true
        every { userSnapshot.contains("lastSyncTimestamp") } returns true
        every { userSnapshot.getLong("lastSyncTimestamp") } returns 1000L

        val result = service.getUserMetaSnapshot()

        assertTrue(result.isSuccess)
        assertEquals(false, result.getOrThrow().isFirstSync)
        assertEquals(1000L, result.getOrThrow().lastSyncTimestamp)
        // Single Firestore GET — not two separate reads.
        verify(exactly = 1) { userDoc.get() }
    }

    /**
     * B2 efficiency-1 — First sync: [getUserMetaSnapshot] returns [isFirstSync] = true
     * when the document has no `lastSyncTimestamp` field.
     */
    @Test
    fun `getUserMetaSnapshot isFirstSync true when no timestamp`() = runTest {
        val userSnapshot = mockk<DocumentSnapshot>()
        every { userDoc.get() } returns Tasks.forResult(userSnapshot)
        every { userSnapshot.exists() } returns true
        every { userSnapshot.contains("lastSyncTimestamp") } returns false
        every { userSnapshot.getLong("lastSyncTimestamp") } returns null

        val result = service.getUserMetaSnapshot()

        assertTrue(result.isSuccess)
        assertEquals(true, result.getOrThrow().isFirstSync)
        assertEquals(null, result.getOrThrow().lastSyncTimestamp)
        verify(exactly = 1) { userDoc.get() }
    }

    // ---------------------------------------------------------------------------
    // B2 efficiency-2 tests (firestore-io slice): tags folded into chunk batch
    // ---------------------------------------------------------------------------

    /**
     * B2 efficiency-2 — [backupArticlesPaginated] writes tag docs into the same
     * batch instance as the article doc when [tagsByArticleId] is supplied.
     * A single article with one tag ⇒ [batch.set] called for both the article doc
     * and the tag doc within the same batch; [batch.commit] called once.
     */
    @Test
    fun `backupArticlesPaginated writes tags inside chunk batch not a separate commit`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val tagsCollection = mockk<CollectionReference>()
        val tagDoc = mockk<DocumentReference>()
        every { articleDoc.collection("tags") } returns tagsCollection
        every { tagsCollection.document("a1_kotlin") } returns tagDoc

        val article = Article(itemId = "a1")
        val tag = ArticleTags(itemId = "a1", tag = "kotlin", sortId = null, type = null)

        val result = service.backupArticlesPaginated(
            articles = listOf(article),
            tagsByArticleId = mapOf("a1" to listOf(tag))
        )

        assertTrue(result.isSuccess)
        // Tag written onto the same batch instance as the article.
        verify(exactly = 1) { batch.set(tagDoc, tag, any()) }
        // Only one batch commit (article + tag together).
        verify(exactly = 1) { batch.commit() }
    }

    /**
     * B2 efficiency-2 — default [emptyMap] preserves previous behaviour: no tag doc
     * writes, no extra batch operations.
     */
    @Test
    fun `backupArticlesPaginated with empty tagsByArticleId writes no tag docs`() = runTest {
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        val article = Article(itemId = "a1")

        val result = service.backupArticlesPaginated(listOf(article))

        assertTrue(result.isSuccess)
        // No tags subcollection accessed.
        verify(exactly = 0) { articleDoc.collection("tags") }
    }

    // ---------------------------------------------------------------------------
    // A2 streaming-API tests (streaming-restore slice)
    // ---------------------------------------------------------------------------

    /** Shared helper: set up the count aggregate for restore tests. */
    private fun stubCountQuery(total: Long) {
        val aggQuery = mockk<AggregateQuery>()
        val aggSnapshot = mockk<AggregateQuerySnapshot>()
        every { articlesCollection.count() } returns aggQuery
        every { aggQuery.get(AggregateSource.SERVER) } returns Tasks.forResult(aggSnapshot)
        every { aggSnapshot.count } returns total
    }

    /** Shared helper: build N mock doc snapshots for a given page id prefix. */
    private fun makePageDocs(prefix: String, count: Int): List<DocumentSnapshot> =
        (1..count).map { i ->
            mockk<DocumentSnapshot>().also {
                every { it.toObject(Article::class.java) } returns Article(itemId = "${prefix}_$i")
                // No subcollection text needed: text is null → rehydrateLargeText will query,
                // but the article doc reference itself is mocked via articleDoc (relaxed).
                // To keep these tests free of subcollection noise we mock text as non-null.
                every { it.toObject(Article::class.java) } returns Article(itemId = "${prefix}_$i", text = "inline")
            }
        }

    /**
     * A2 — Multi-page: onPage is called once per page (not once with the full list).
     * Two pages of 50 + 10 ⇒ onPage called exactly twice.
     */
    @Test
    fun `restoreAllArticlesPaginated calls onPage per page not once with full list`() = runTest {
        stubCountQuery(60L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        val page1Docs = makePageDocs("p1", 50)
        val page1Query = mockk<Query>()
        val page1 = mockk<QuerySnapshot>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns page1Docs
        every { page1Query.get() } returns Tasks.forResult(page1)

        val lastDocPage1 = page1Docs.last()
        val page2AfterQuery = mockk<Query>()
        val page2LimitedQuery = mockk<Query>()
        val page2 = mockk<QuerySnapshot>()
        val page2Docs = makePageDocs("p2", 10)
        every { orderedQuery.startAfter(lastDocPage1) } returns page2AfterQuery
        every { page2AfterQuery.limit(50L) } returns page2LimitedQuery
        every { page2.documents } returns page2Docs
        every { page2LimitedQuery.get() } returns Tasks.forResult(page2)

        val pagesReceived = mutableListOf<List<Article>>()
        val result = service.restoreAllArticlesPaginated(
            onPage = { page -> pagesReceived.add(page) }
        )

        assertTrue(result.isSuccess)
        assertEquals(2, pagesReceived.size)
        assertEquals(50, pagesReceived[0].size)
        assertEquals(10, pagesReceived[1].size)
    }

    /**
     * A2 — Zero articles: count returns 0, first page is empty → onPage never called;
     * return is Result.success(Unit).
     */
    @Test
    fun `restoreAllArticlesPaginated zero articles never calls onPage`() = runTest {
        stubCountQuery(0L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        val emptySnapshot = mockk<QuerySnapshot>()
        val emptyQuery = mockk<Query>()
        every { orderedQuery.limit(50L) } returns emptyQuery
        every { emptySnapshot.documents } returns emptyList()
        every { emptyQuery.get() } returns Tasks.forResult(emptySnapshot)

        var onPageCallCount = 0
        val result = service.restoreAllArticlesPaginated(
            onPage = { onPageCallCount++ }
        )

        assertTrue(result.isSuccess)
        assertEquals(0, onPageCallCount)
    }

    /**
     * A2 — Single page: one page of 30 articles (< 50 page limit) → onPage called
     * exactly once with 30 articles; return is Result.success(Unit).
     */
    @Test
    fun `restoreAllArticlesPaginated single page calls onPage once`() = runTest {
        stubCountQuery(30L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        val page1Docs = makePageDocs("s", 30)
        val page1Query = mockk<Query>()
        val page1 = mockk<QuerySnapshot>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns page1Docs
        every { page1Query.get() } returns Tasks.forResult(page1)

        var callCount = 0
        var receivedSize = 0
        val result = service.restoreAllArticlesPaginated(
            onPage = { page -> callCount++; receivedSize = page.size }
        )

        assertTrue(result.isSuccess)
        assertEquals(1, callCount)
        assertEquals(30, receivedSize)
    }

    /**
     * A2 — onPage failure stops paging and returns Result.failure; onPage is not
     * called a second time.
     */
    @Test
    fun `restoreAllArticlesPaginated onPage failure stops paging and returns failure`() = runTest {
        stubCountQuery(100L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        // Page 1: full 50 docs.
        val page1Docs = makePageDocs("f", 50)
        val page1Query = mockk<Query>()
        val page1 = mockk<QuerySnapshot>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns page1Docs
        every { page1Query.get() } returns Tasks.forResult(page1)

        var callCount = 0
        val result = service.restoreAllArticlesPaginated(
            onPage = {
                callCount++
                throw RuntimeException("Room write failed")
            }
        )

        assertTrue(result.isFailure)
        assertEquals(1, callCount)
    }

    // ---------------------------------------------------------------------------
    // A2b rehydration tests (streaming-restore slice)
    // ---------------------------------------------------------------------------

    /**
     * A2b — Happy path: article with text == null gets its large text from the
     * text/content subcollection and the hydrated text is delivered via onPage.
     */
    @Test
    fun `restoreAllArticlesPaginated rehydrates large text from subcollection`() = runTest {
        stubCountQuery(1L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        // One-article page with text == null (stored in subcollection).
        val docWithNullText = mockk<DocumentSnapshot>().also {
            every { it.toObject(Article::class.java) } returns Article(itemId = "large1", text = null)
        }
        val page1 = mockk<QuerySnapshot>()
        val page1Query = mockk<Query>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns listOf(docWithNullText)
        every { page1Query.get() } returns Tasks.forResult(page1)

        // Mock the subcollection for the article doc.
        val textCollection = mockk<CollectionReference>()
        val textDocRef = mockk<DocumentReference>()
        val textDocSnapshot = mockk<DocumentSnapshot>()
        every { articleDoc.collection("text") } returns textCollection
        every { textCollection.document("content") } returns textDocRef
        every { textDocRef.get() } returns Tasks.forResult(textDocSnapshot)
        every { textDocSnapshot.exists() } returns true
        every { textDocSnapshot.getString("text") } returns "large content"

        val receivedArticles = mutableListOf<Article>()
        val result = service.restoreAllArticlesPaginated(
            onPage = { page -> receivedArticles.addAll(page) }
        )

        assertTrue(result.isSuccess)
        assertEquals(1, receivedArticles.size)
        assertEquals("large content", receivedArticles[0].text)
    }

    /**
     * A2b — Inline text path: article with non-null text is returned unchanged;
     * no subcollection read is issued.
     */
    @Test
    fun `restoreAllArticlesPaginated inline text not fetched from subcollection`() = runTest {
        stubCountQuery(1L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        val docWithText = mockk<DocumentSnapshot>().also {
            every { it.toObject(Article::class.java) } returns Article(itemId = "inline1", text = "short")
        }
        val page1 = mockk<QuerySnapshot>()
        val page1Query = mockk<Query>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns listOf(docWithText)
        every { page1Query.get() } returns Tasks.forResult(page1)

        val receivedArticles = mutableListOf<Article>()
        val result = service.restoreAllArticlesPaginated(
            onPage = { page -> receivedArticles.addAll(page) }
        )

        assertTrue(result.isSuccess)
        assertEquals(1, receivedArticles.size)
        assertEquals("short", receivedArticles[0].text)
        // No subcollection read was made.
        verify(exactly = 0) { articleDoc.collection("text") }
    }

    /**
     * A2b — Subcollection missing: article with text == null and no text/content doc
     * → article delivered to onPage with text == null; no exception propagated.
     */
    @Test
    fun `restoreAllArticlesPaginated missing subcollection text is null`() = runTest {
        stubCountQuery(1L)
        val orderedQuery = mockk<Query>()
        every { articlesCollection.orderBy("timeAdded") } returns orderedQuery

        val docWithNullText = mockk<DocumentSnapshot>().also {
            every { it.toObject(Article::class.java) } returns Article(itemId = "missing1", text = null)
        }
        val page1 = mockk<QuerySnapshot>()
        val page1Query = mockk<Query>()
        every { orderedQuery.limit(50L) } returns page1Query
        every { page1.documents } returns listOf(docWithNullText)
        every { page1Query.get() } returns Tasks.forResult(page1)

        val textCollection = mockk<CollectionReference>()
        val textDocRef = mockk<DocumentReference>()
        val textDocSnapshot = mockk<DocumentSnapshot>()
        every { articleDoc.collection("text") } returns textCollection
        every { textCollection.document("content") } returns textDocRef
        every { textDocRef.get() } returns Tasks.forResult(textDocSnapshot)
        every { textDocSnapshot.exists() } returns false

        val receivedArticles = mutableListOf<Article>()
        val result = service.restoreAllArticlesPaginated(
            onPage = { page -> receivedArticles.addAll(page) }
        )

        assertTrue(result.isSuccess)
        assertEquals(1, receivedArticles.size)
        assertNull(receivedArticles[0].text)
    }

    // ---------------------------------------------------------------------------
    // A3 batchRestoreArticleTags read-count tests (batched-tag-reads slice)
    // ---------------------------------------------------------------------------

    /**
     * Helper: build a mock QuerySnapshot for a tags collection containing [tags].
     */
    private fun makeTagsSnapshot(tags: List<ArticleTags>): QuerySnapshot {
        val snap = mockk<QuerySnapshot>()
        val docs = tags.map { tag ->
            mockk<DocumentSnapshot>().also {
                every { it.toObject(ArticleTags::class.java) } returns tag
            }
        }
        every { snap.documents } returns docs
        return snap
    }

    /**
     * Helper: wire the mocked Firestore chain for tags subcollection reads.
     * Returns a map of articleId → CollectionReference for read-count verification.
     */
    private fun stubTagsCollection(
        articleIds: List<String>,
        tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap()
    ): Map<String, CollectionReference> {
        val tagsCollectionByArticleId = mutableMapOf<String, CollectionReference>()
        articleIds.forEach { id ->
            val articleDocRef = mockk<DocumentReference>()
            every { articlesCollection.document(id) } returns articleDocRef
            val tagsCollection = mockk<CollectionReference>()
            every { articleDocRef.collection("tags") } returns tagsCollection
            val tagsSnapshot = makeTagsSnapshot(tagsByArticleId[id] ?: emptyList())
            every { tagsCollection.get() } returns Tasks.forResult(tagsSnapshot)
            tagsCollectionByArticleId[id] = tagsCollection
        }
        return tagsCollectionByArticleId
    }

    /**
     * A3 — Empty list: batchRestoreArticleTags([]) → 0 Firestore reads, returns empty map.
     */
    @Test
    fun `batchRestoreArticleTags empty list returns empty map with zero reads`() = runTest {
        val result = service.batchRestoreArticleTags(emptyList())

        assertTrue(result.isEmpty())
        // No article document lookup should have occurred.
        verify(exactly = 0) { articlesCollection.document(any()) }
    }

    /**
     * A3 — Single article: batchRestoreArticleTags(["a1"]) → 1 tags read,
     * returns {"a1": [tag]}.
     */
    @Test
    fun `batchRestoreArticleTags single article issues one read and returns its tags`() = runTest {
        val tag = ArticleTags(itemId = "a1", tag = "kotlin", sortId = null, type = null)
        val tagsCollections = stubTagsCollection(listOf("a1"), mapOf("a1" to listOf(tag)))

        val result = service.batchRestoreArticleTags(listOf("a1"))

        assertEquals(1, result.size)
        assertEquals(listOf(tag), result["a1"])
        verify(exactly = 1) { tagsCollections["a1"]!!.get() }
    }

    /**
     * A3 — 10 IDs (one full chunk): batchRestoreArticleTags(10 ids) → all 10 reads
     * dispatched in a single parallel round (one chunk of RESTORE_TAG_CHUNK_SIZE=10).
     */
    @Test
    fun `batchRestoreArticleTags 10 ids issues 10 reads in one chunk`() = runTest {
        val ids = (1..10).map { "a$it" }
        val tagsCollections = stubTagsCollection(ids)

        val result = service.batchRestoreArticleTags(ids)

        assertEquals(10, result.size)
        ids.forEach { id -> assertTrue(result.containsKey(id)) }
        tagsCollections.values.forEach { col ->
            verify(exactly = 1) { col.get() }
        }
    }

    /**
     * A3 — 11 IDs (two chunks: 10+1): batchRestoreArticleTags(11 ids) → 11 reads
     * split into two parallel rounds. All 11 results are present in the returned map.
     */
    @Test
    fun `batchRestoreArticleTags 11 ids splits into two chunks and returns all results`() = runTest {
        val ids = (1..11).map { "b$it" }
        val tagsCollections = stubTagsCollection(ids)

        val result = service.batchRestoreArticleTags(ids)

        assertEquals(11, result.size)
        ids.forEach { id -> assertTrue(result.containsKey(id)) }
        tagsCollections.values.forEach { col ->
            verify(exactly = 1) { col.get() }
        }
    }

    /**
     * A3 — Article with no tags: batchRestoreArticleTags still returns an entry for
     * that article keyed with an empty list; no exception is thrown.
     */
    @Test
    fun `batchRestoreArticleTags article with no tags returns empty list entry`() = runTest {
        stubTagsCollection(listOf("noTagArticle"), mapOf("noTagArticle" to emptyList()))

        val result = service.batchRestoreArticleTags(listOf("noTagArticle"))

        assertEquals(1, result.size)
        assertTrue(result.containsKey("noTagArticle"))
        assertEquals(emptyList<ArticleTags>(), result["noTagArticle"])
    }

    /**
     * A3 — Unauthenticated: batchRestoreArticleTags when no user is signed in
     * returns an empty map and issues no Firestore reads.
     */
    @Test
    fun `batchRestoreArticleTags returns empty map when unauthenticated`() = runTest {
        every { auth.currentUser } returns null

        val result = service.batchRestoreArticleTags(listOf("a1", "a2"))

        assertTrue(result.isEmpty())
        verify(exactly = 0) { articlesCollection.document(any()) }
    }
}
