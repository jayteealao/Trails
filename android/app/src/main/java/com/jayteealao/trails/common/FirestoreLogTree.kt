package com.jayteealao.trails.common

import android.util.Log
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import timber.log.Timber
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Debug-only Timber tree that aggregates log entries per article session in Firestore.
 *
 * Structure: debug_logs/{sessionId}_{articleId}
 *   - sessionId, articleId, device, enteredAt
 *   - events: [ { ts, tag, msg, level, error? }, ... ]
 *
 * Only logs from archive-related tags are forwarded.
 * Article ID is extracted from log message patterns like method(articleId).
 */
class FirestoreLogTree : Timber.DebugTree() {

    private val sessionId = UUID.randomUUID().toString().take(8)
    private val firestore = FirebaseFirestore.getInstance()
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

        val articleId = extractArticleId(message) ?: "session"
        val docRef = getOrCreateDoc(articleId)

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

    private fun getOrCreateDoc(articleId: String): DocumentReference {
        return articleDocs.getOrPut(articleId) {
            val docId = "${sessionId}_${articleId}"
            val ref = firestore.collection("debug_logs").document(docId)
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
