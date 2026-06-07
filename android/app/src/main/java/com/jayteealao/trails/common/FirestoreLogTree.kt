package com.jayteealao.trails.common

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import timber.log.Timber
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Debug-only Timber tree that aggregates log entries per article session in Firestore.
 *
 * Structure: debug_logs/{uid}/sessions/{sessionId}_{articleId}
 *   - sessionId, articleId, device, enteredAt
 *   - events: [ { ts, tag, msg, level, error? }, ... ]
 *
 * Owner-scoped under the signed-in user's uid (matches the firestore.rules
 * `debug_logs/{userId}/sessions/{sessionId}` match). Logging is skipped when no
 * user is signed in. Only logs from archive-related tags are forwarded.
 * Article ID is extracted from log message patterns like method(articleId).
 */
@Singleton
class FirestoreLogTree @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth,
) : Timber.DebugTree() {

    private val sessionId = UUID.randomUUID().toString().take(8)
    private val articleDocs = ConcurrentHashMap<String, DocumentReference>()

    private val relevantTags = setOf(
        "ArchiveService",
        "ArticleDetailViewModel",
        "SyncWorker",
        "FirestoreSyncWorker",
    )

    // Matches method(ARTICLE_ID) or "for ARTICLE_ID"
    private val articleIdPattern = Regex("""\(([A-Za-z0-9]{8,})(?:[,)])|for ([A-Za-z0-9]{8,})\b""")

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        if (priority < Log.DEBUG) return

        val isRelevant = tag != null && relevantTags.any { tag.contains(it) }
        if (!isRelevant) return

        // Owner-scoped path requires a signed-in uid; skip otherwise.
        val uid = auth.currentUser?.uid ?: return
        val articleId = extractArticleId(message) ?: "session"
        val docRef = getOrCreateDoc(uid, articleId)

        val event = mutableMapOf<String, Any>(
            "ts" to System.currentTimeMillis(),
            "tag" to (tag ?: ""),
            "msg" to message,
            "level" to priorityLabel(priority),
        )
        if (t != null) {
            event["error"] = t.stackTraceToString().take(500)
        }

        docRef.update("events", FieldValue.arrayUnion(event))
    }

    private fun extractArticleId(message: String): String? {
        val match = articleIdPattern.find(message) ?: return null
        val id = match.groupValues[1].ifEmpty { match.groupValues[2] }
        return id.ifEmpty { null }
    }

    private fun getOrCreateDoc(uid: String, articleId: String): DocumentReference {
        return articleDocs.getOrPut(articleId) {
            val docId = "${sessionId}_${articleId}"
            val ref = firestore.collection("debug_logs")
                .document(uid)
                .collection("sessions")
                .document(docId)
            ref.set(
                mapOf(
                    "sessionId" to sessionId,
                    "articleId" to articleId,
                    "device" to android.os.Build.MODEL,
                    "enteredAt" to System.currentTimeMillis(),
                    "events" to listOf<Map<String, Any>>(),
                )
            )
            ref
        }
    }

    private fun priorityLabel(priority: Int): String = when (priority) {
        Log.VERBOSE -> "V"
        Log.DEBUG -> "D"
        Log.INFO -> "I"
        Log.WARN -> "W"
        Log.ERROR -> "E"
        else -> "?"
    }
}
