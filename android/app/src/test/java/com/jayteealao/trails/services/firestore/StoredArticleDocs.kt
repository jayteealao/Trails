package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.data.local.database.Article

/**
 * The map a restored user-article doc returns from `DocumentSnapshot.getData()`: the
 * fields the backup writes plus the server-owned `resolvedId`, with every integer a
 * `Long`, as Firestore hands stored integers out.
 */
fun storedDoc(article: Article, resolvedId: String? = article.resolvedId): Map<String, Any> {
    val fields = article.toUserArticleWire().toFirestore() + (UserArticleWire.RESOLVED_ID to resolvedId)
    val stored = fields.mapValues { (_, value) -> if (value is Int) value.toLong() else value }
    @Suppress("UNCHECKED_CAST") // sdlc-debt: ceiling — Firestore types getData() as Map<String, Any> while stored values can be null. Upgrade path: none needed unless the SDK types the map's values as nullable.
    return stored as Map<String, Any>
}
