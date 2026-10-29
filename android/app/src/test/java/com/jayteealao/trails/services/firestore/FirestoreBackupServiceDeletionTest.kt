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
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.WriteBatch
import com.google.firebase.firestore.util.CustomClassMapper
import com.jayteealao.trails.data.local.database.Article
import io.mockk.clearAllMocks
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Deletions on the wire and on restore: a deleted article is backed up under
 * `deletedAt` only, and a restore reads `deletedAt` or the old `deleted_at` key and
 * rewrites old docs to `deletedAt` before the page reaches the local database.
 */
class FirestoreBackupServiceDeletionTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var batch: WriteBatch
    private lateinit var articlesCollection: CollectionReference
    private lateinit var articleDoc: DocumentReference
    private lateinit var service: FirestoreBackupService

    /** Calls in the order they happened: heal commits and onPage deliveries. */
    private val calls = mutableListOf<String>()

    @Before
    fun setUp() {
        firestore = mockk()
        val auth = mockk<FirebaseAuth>()
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "u1"
        every { auth.currentUser } returns user

        val usersCollection = mockk<CollectionReference>()
        val userDoc = mockk<DocumentReference>()
        val markersCollection = mockk<CollectionReference>()
        articlesCollection = mockk()
        articleDoc = mockk(relaxed = true)
        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document("u1") } returns userDoc
        every { userDoc.collection("articleMarkers") } returns markersCollection
        every { userDoc.collection("articles") } returns articlesCollection
        every { markersCollection.document(any()) } returns mockk(relaxed = true)
        every { articlesCollection.document(any()) } returns articleDoc

        batch = mockk(relaxed = true)
        every { firestore.batch() } returns batch
        every { batch.commit() } answers {
            calls += "commit"
            Tasks.forResult(null)
        }

        service = FirestoreBackupService(firestore, auth)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    /** The field map Firestore receives for a written value: a map as is, a bean converted. */
    private fun fields(value: Any): Map<*, *> =
        value as? Map<*, *> ?: CustomClassMapper.convertToPlainJavaTypes(value) as Map<*, *>

    private fun doc(
        id: String,
        article: Article,
        deletedAt: Long?,
        legacy: Long?,
        legacyPresent: Boolean,
    ): Pair<DocumentSnapshot, DocumentReference> {
        val ref = mockk<DocumentReference>(name = "ref-$id")
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.toObject(Article::class.java) } returns article
        every { snapshot.getLong("deletedAt") } returns deletedAt
        every { snapshot.getLong("deleted_at") } returns legacy
        every { snapshot.contains("deleted_at") } returns legacyPresent
        every { snapshot.reference } returns ref
        every { snapshot.id } returns id
        return snapshot to ref
    }

    private fun stubOnePage(vararg docs: DocumentSnapshot) {
        val aggQuery = mockk<AggregateQuery>()
        val aggSnapshot = mockk<AggregateQuerySnapshot>()
        every { articlesCollection.count() } returns aggQuery
        every { aggQuery.get(AggregateSource.SERVER) } returns Tasks.forResult(aggSnapshot)
        every { aggSnapshot.count } returns docs.size.toLong()

        val ordered = mockk<Query>()
        val limited = mockk<Query>()
        val page = mockk<QuerySnapshot>()
        every { articlesCollection.orderBy("timeAdded") } returns ordered
        every { ordered.limit(50L) } returns limited
        every { limited.get() } returns Tasks.forResult(page)
        every { page.documents } returns docs.toList()
    }

    @Test
    fun `a deleted article is backed up as deletedAt with no deleted_at key`() = runTest {
        val written = slot<Any>()
        every { batch.set(articleDoc, capture(written), any<SetOptions>()) } returns batch

        val result = service.backupArticlesPaginated(
            listOf(Article(itemId = "a1", title = "Gone", text = "body", timeUpdated = 1_700L, deletedAt = 1_700L)),
        )

        assertTrue(result.isSuccess)
        val wire = fields(written.captured)
        assertEquals(1_700L, wire["deletedAt"])
        assertFalse(wire.containsKey("deleted_at"))
    }

    @Test
    fun `legacy, current and both-key docs all restore as deleted and old keys are healed`() = runTest {
        val (legacyOnly, legacyRef) = doc(
            "legacy", Article(itemId = "legacy", text = "t", timeUpdated = 100L),
            deletedAt = null, legacy = 300L, legacyPresent = true,
        )
        val (currentOnly, currentRef) = doc(
            "current", Article(itemId = "current", text = "t", timeUpdated = 400L, deletedAt = 400L),
            deletedAt = 400L, legacy = null, legacyPresent = false,
        )
        val (both, bothRef) = doc(
            "both", Article(itemId = "both", text = "t", timeUpdated = 500L, deletedAt = 500L),
            deletedAt = 500L, legacy = 200L, legacyPresent = true,
        )
        stubOnePage(legacyOnly, currentOnly, both)
        val healed = mutableMapOf<DocumentReference, Map<*, *>>()
        every { batch.set(any<DocumentReference>(), any<Map<String, Any>>(), any<SetOptions>()) } answers {
            healed[firstArg()] = secondArg()
            batch
        }

        val pages = mutableListOf<List<Article>>()
        val result = service.restoreAllArticlesPaginated(onPage = { pages += it })

        assertTrue(result.isSuccess)
        val restored = pages.single().associateBy { it.itemId }
        assertEquals(300L, restored.getValue("legacy").deletedAt)
        assertEquals(400L, restored.getValue("current").deletedAt)
        assertEquals(500L, restored.getValue("both").deletedAt)

        val legacyHeal = healed.getValue(legacyRef)
        assertEquals(300L, legacyHeal["deletedAt"])
        assertSame(FieldValue.delete(), legacyHeal["deleted_at"])
        val bothHeal = healed.getValue(bothRef)
        assertEquals(setOf("deleted_at"), bothHeal.keys)
        assertSame(FieldValue.delete(), bothHeal["deleted_at"])
        assertNull(healed[currentRef])
        verify(exactly = 1) { batch.commit() }
    }

    @Test
    fun `the heal commits before the page reaches onPage`() = runTest {
        val (legacyOnly, _) = doc(
            "legacy", Article(itemId = "legacy", text = "t", timeUpdated = 100L),
            deletedAt = null, legacy = 300L, legacyPresent = true,
        )
        stubOnePage(legacyOnly)

        val result = service.restoreAllArticlesPaginated(onPage = { calls += "onPage" })

        assertTrue(result.isSuccess)
        assertEquals(listOf("commit", "onPage"), calls)
    }

    @Test
    fun `a failed heal does not fail the restore`() = runTest {
        val (legacyOnly, _) = doc(
            "legacy", Article(itemId = "legacy", text = "t", timeUpdated = 100L),
            deletedAt = null, legacy = 300L, legacyPresent = true,
        )
        stubOnePage(legacyOnly)
        every { batch.commit() } returns Tasks.forException(RuntimeException("offline"))

        val pages = mutableListOf<List<Article>>()
        val result = service.restoreAllArticlesPaginated(onPage = { pages += it })

        assertTrue(result.isSuccess)
        assertEquals(300L, pages.single().single().deletedAt)
    }

    @Test
    fun `an article saved again after an old delete restores live and only drops the old key`() = runTest {
        val (readded, readdedRef) = doc(
            "readded", Article(itemId = "readded", text = "t", timeUpdated = 200L),
            deletedAt = null, legacy = 100L, legacyPresent = true,
        )
        stubOnePage(readded)
        val healed = mutableMapOf<DocumentReference, Map<*, *>>()
        every { batch.set(any<DocumentReference>(), any<Map<String, Any>>(), any<SetOptions>()) } answers {
            healed[firstArg()] = secondArg()
            batch
        }

        val pages = mutableListOf<List<Article>>()
        val result = service.restoreAllArticlesPaginated(onPage = { pages += it })

        assertTrue(result.isSuccess)
        val article = pages.single().single()
        assertNull(article.deletedAt)
        assertEquals(200L, article.timeUpdated)
        assertEquals(setOf("deleted_at"), healed.getValue(readdedRef).keys)
    }
}
