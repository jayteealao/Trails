package com.jayteealao.trails.testing

import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QueryDocumentSnapshot
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.WriteBatch
import io.mockk.every
import io.mockk.mockk

/**
 * A Firestore stand-in that keeps committed docs in a map keyed by path, for JVM tests
 * of the real backup service.
 *
 * Batches record each `set(ref, data, options)` and apply them to [docs] on `commit()`,
 * merging fields as `SetOptions.merge()` does. A collection's `get()` serves the docs
 * stored directly under its path as query snapshots (`id`, `data`); `toObject` is never
 * stubbed, so the code under test has to read the stored maps. A field map is stored as
 * it is; any other written object is stored under the key `"object"`.
 *
 * References are cached per path, so a test can verify calls on
 * [document]`(path)` / [collection]`(path)`.
 */
class MapBackedFirestore(uid: String = "u1") {
    val firestore: FirebaseFirestore = mockk()
    val auth: FirebaseAuth = mockk()

    /** Committed docs by path. */
    val docs = linkedMapOf<String, Map<String, Any?>>()

    /** One entry per committed batch: the doc paths it set, in order. */
    val commits = mutableListOf<List<String>>()

    /** Collection paths whose `get()` fails. */
    val failingReads = mutableSetOf<String>()

    private val collections = mutableMapOf<String, CollectionReference>()
    private val documents = mutableMapOf<String, DocumentReference>()

    init {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns uid
        every { auth.currentUser } returns user
        every { firestore.collection(any()) } answers { collection(firstArg()) }
        every { firestore.batch() } answers { newBatch() }
    }

    fun collection(path: String): CollectionReference = collections.getOrPut(path) {
        val ref = mockk<CollectionReference>()
        every { ref.path } returns path
        every { ref.document(any()) } answers { document("$path/${firstArg<String>()}") }
        every { ref.get() } answers { query(path) }
        ref
    }

    fun document(path: String): DocumentReference = documents.getOrPut(path) {
        val ref = mockk<DocumentReference>()
        every { ref.path } returns path
        every { ref.id } returns path.substringAfterLast('/')
        every { ref.collection(any()) } answers { collection("$path/${firstArg<String>()}") }
        ref
    }

    /** Docs stored directly under [collectionPath], keyed by doc id. */
    fun docsUnder(collectionPath: String): Map<String, Map<String, Any?>> =
        docs.filterKeys { it.startsWith("$collectionPath/") && '/' !in it.removePrefix("$collectionPath/") }
            .mapKeys { it.key.removePrefix("$collectionPath/") }

    private fun query(path: String): Task<QuerySnapshot> {
        if (path in failingReads) return Tasks.forException(IllegalStateException("read failed: $path"))
        val snapshots: List<DocumentSnapshot> = docsUnder(path).map { (id, data) ->
            val snap = mockk<QueryDocumentSnapshot>()
            every { snap.id } returns id
            @Suppress("UNCHECKED_CAST") // sdlc-debt: ceiling — Firestore types getData() as Map<String, Any>; the fake stores nullable values as written. Upgrade path: a typed fake store if a non-map value ever needs reading back.
            every { snap.data } returns data as Map<String, Any>
            snap
        }
        val result = mockk<QuerySnapshot>()
        every { result.documents } returns snapshots
        every { result.isEmpty } returns snapshots.isEmpty()
        every { result.size() } returns snapshots.size
        return Tasks.forResult(result)
    }

    private fun newBatch(): WriteBatch {
        val pending = mutableListOf<Pair<String, Map<String, Any?>>>()
        val batch = mockk<WriteBatch>()
        every { batch.set(any<DocumentReference>(), any<Any>(), any<SetOptions>()) } answers {
            val ref = firstArg<DocumentReference>()
            val data = secondArg<Any>()
            @Suppress("UNCHECKED_CAST") // sdlc-debt: ceiling — the fake trusts that written field maps are Map<String, Any?>; anything else is wrapped. Upgrade path: a typed fake store if a non-map value ever needs reading back.
            pending += ref.path to ((data as? Map<String, Any?>) ?: mapOf("object" to data))
            batch
        }
        every { batch.commit() } answers {
            pending.forEach { (path, fields) -> docs[path] = docs[path].orEmpty() + fields }
            commits += pending.map { it.first }
            pending.clear()
            Tasks.forResult(null)
        }
        return batch
    }
}
