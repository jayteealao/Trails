package com.jayteealao.trails.services.firestore

import com.google.firebase.Timestamp
import com.jayteealao.trails.data.local.database.Article

/**
 * The user article as it is stored on `users/{uid}/articles/{id}`: the one place the app
 * spells that document's Firestore field names. App versions in users' hands and the
 * server read these names, so they never change with the local database: a rename of an
 * [Article] property or column changes only the right-hand side of [toUserArticleWire]
 * and [toArticle], never a name below. The shared-types drift check reads this file for
 * the fields the server reads.
 *
 * [backedUpAt] is the version a backup sends (the article's `timeUpdated`); older builds
 * read it back on restore. [resolvedId] is server-owned: it is read back, never written.
 */
internal data class UserArticleWire(
    val itemId: String = "",
    val resolvedId: String? = null,
    val title: String = "",
    val givenTitle: String = "",
    val url: String? = null,
    val givenUrl: String? = null,
    val normalizedUrl: String? = null,
    val excerpt: String? = null,
    val wordCount: Int = 0,
    val favorite: String? = null,
    val status: String = "",
    val wordCountMessage: String? = null,
    val image: String? = null,
    val hasImage: Boolean = false,
    val hasVideo: Boolean = false,
    val hasAudio: Boolean = false,
    val sortId: Int = 0,
    val timeAdded: Long = 0,
    val timeUpdated: Long = 0,
    val timeRead: Long? = null,
    val timeFavorited: Long = 0,
    val timeToRead: Int? = 0,
    val listenDurationEstimate: Int = 0,
    val text: String? = null,
    val articleId: String = "0",
    val resolved: Int = 0,
    val deletedAt: Long? = null,
    val archivedAt: Long? = null,
    val textSource: String = "",
    val backedUpAt: Long = timeUpdated,
) {
    /** The field map a backup merge-writes, without the server-owned [resolvedId]. */
    fun toFirestore(): Map<String, Any?> = linkedMapOf(
        ITEM_ID to itemId,
        TITLE to title,
        GIVEN_TITLE to givenTitle,
        URL to url,
        GIVEN_URL to givenUrl,
        NORMALIZED_URL to normalizedUrl,
        EXCERPT to excerpt,
        WORD_COUNT to wordCount,
        FAVORITE to favorite,
        STATUS to status,
        WORD_COUNT_MESSAGE to wordCountMessage,
        IMAGE to image,
        HAS_IMAGE to hasImage,
        HAS_VIDEO to hasVideo,
        HAS_AUDIO to hasAudio,
        SORT_ID to sortId,
        TIME_ADDED to timeAdded,
        TIME_UPDATED to timeUpdated,
        TIME_READ to timeRead,
        TIME_FAVORITED to timeFavorited,
        TIME_TO_READ to timeToRead,
        LISTEN_DURATION_ESTIMATE to listenDurationEstimate,
        TEXT to text,
        ARTICLE_ID to articleId,
        RESOLVED to resolved,
        DELETED_AT to deletedAt,
        ARCHIVED_AT to archivedAt,
        TEXT_SOURCE to textSource,
        BACKED_UP_AT to backedUpAt,
    )

    /** The article this stored document restores to; [backedUpAt] is not part of it. */
    fun toArticle() = Article(
        itemId = itemId,
        resolvedId = resolvedId,
        title = title,
        givenTitle = givenTitle,
        url = url,
        givenUrl = givenUrl,
        normalizedUrl = normalizedUrl,
        excerpt = excerpt,
        wordCount = wordCount,
        favorite = favorite,
        status = status,
        wordCountMessage = wordCountMessage,
        image = image,
        hasImage = hasImage,
        hasVideo = hasVideo,
        hasAudio = hasAudio,
        sortId = sortId,
        timeAdded = timeAdded,
        timeUpdated = timeUpdated,
        timeRead = timeRead,
        timeFavorited = timeFavorited,
        timeToRead = timeToRead,
        listenDurationEstimate = listenDurationEstimate,
        text = text,
        articleId = articleId,
        resolved = resolved,
        deletedAt = deletedAt,
        archivedAt = archivedAt,
        textSource = textSource,
    )

    companion object {
        /**
         * Reads a stored document as `DocumentSnapshot.getData()` returns it, by the rules
         * Firestore's object mapper applied when the app read the article entity directly:
         * a missing field takes its default, an unknown field is ignored, a number is
         * narrowed or truncated as the mapper does, and a value the mapper refused (a
         * wrong type, an out-of-range number, a null in a non-null number or boolean)
         * throws [IllegalArgumentException] naming the field. A null in a non-null text
         * field reads as that field's default. One rule differs from the mapper: a
         * Firestore [Timestamp] in a time field (the dashboard queue stores `timeAdded`
         * that way) reads as epoch milliseconds, the unit the app stores, so a queued
         * article restores instead of failing its restore page.
         */
        fun fromFirestore(data: Map<String, Any?>) = UserArticleWire(
            itemId = data.wireString(ITEM_ID, "") ?: "",
            resolvedId = data.wireString(RESOLVED_ID, null),
            title = data.wireString(TITLE, "") ?: "",
            givenTitle = data.wireString(GIVEN_TITLE, "") ?: "",
            url = data.wireString(URL, null),
            givenUrl = data.wireString(GIVEN_URL, null),
            normalizedUrl = data.wireString(NORMALIZED_URL, null),
            excerpt = data.wireString(EXCERPT, null),
            wordCount = data.wireInt(WORD_COUNT, 0) ?: nullIn(WORD_COUNT),
            favorite = data.wireString(FAVORITE, null),
            status = data.wireString(STATUS, "") ?: "",
            wordCountMessage = data.wireString(WORD_COUNT_MESSAGE, null),
            image = data.wireString(IMAGE, null),
            hasImage = data.wireBoolean(HAS_IMAGE, false) ?: nullIn(HAS_IMAGE),
            hasVideo = data.wireBoolean(HAS_VIDEO, false) ?: nullIn(HAS_VIDEO),
            hasAudio = data.wireBoolean(HAS_AUDIO, false) ?: nullIn(HAS_AUDIO),
            sortId = data.wireInt(SORT_ID, 0) ?: nullIn(SORT_ID),
            timeAdded = data.wireLong(TIME_ADDED, 0) ?: nullIn(TIME_ADDED),
            timeUpdated = data.wireLong(TIME_UPDATED, 0) ?: nullIn(TIME_UPDATED),
            timeRead = data.wireLong(TIME_READ, null),
            timeFavorited = data.wireLong(TIME_FAVORITED, 0) ?: nullIn(TIME_FAVORITED),
            timeToRead = data.wireInt(TIME_TO_READ, 0),
            listenDurationEstimate = data.wireInt(LISTEN_DURATION_ESTIMATE, 0)
                ?: nullIn(LISTEN_DURATION_ESTIMATE),
            text = data.wireString(TEXT, null),
            articleId = data.wireString(ARTICLE_ID, "0") ?: "0",
            resolved = data.wireInt(RESOLVED, 0) ?: nullIn(RESOLVED),
            deletedAt = data.wireLong(DELETED_AT, null),
            archivedAt = data.wireLong(ARCHIVED_AT, null),
            textSource = data.wireString(TEXT_SOURCE, "") ?: "",
        )

        const val ITEM_ID = "itemId"
        const val RESOLVED_ID = "resolvedId"
        const val TITLE = "title"
        const val GIVEN_TITLE = "givenTitle"
        const val URL = "url"
        const val GIVEN_URL = "givenUrl"
        const val NORMALIZED_URL = "normalizedUrl"
        const val EXCERPT = "excerpt"
        const val WORD_COUNT = "wordCount"
        const val FAVORITE = "favorite"
        const val STATUS = "status"
        const val WORD_COUNT_MESSAGE = "wordCountMessage"
        const val IMAGE = "image"
        const val HAS_IMAGE = "hasImage"
        const val HAS_VIDEO = "hasVideo"
        const val HAS_AUDIO = "hasAudio"
        const val SORT_ID = "sortId"
        const val TIME_ADDED = "timeAdded"
        const val TIME_UPDATED = "timeUpdated"
        const val TIME_READ = "timeRead"
        const val TIME_FAVORITED = "timeFavorited"
        const val TIME_TO_READ = "timeToRead"
        const val LISTEN_DURATION_ESTIMATE = "listenDurationEstimate"
        const val TEXT = "text"
        const val ARTICLE_ID = "articleId"
        const val RESOLVED = "resolved"
        const val DELETED_AT = "deletedAt"
        const val ARCHIVED_AT = "archivedAt"
        const val TEXT_SOURCE = "textSource"
        const val BACKED_UP_AT = "backedUpAt"
    }
}

/** The wire form of this article; a backup sends `timeUpdated` as [UserArticleWire.backedUpAt]. */
internal fun Article.toUserArticleWire() = UserArticleWire(
    itemId = itemId,
    resolvedId = resolvedId,
    title = title,
    givenTitle = givenTitle,
    url = url,
    givenUrl = givenUrl,
    normalizedUrl = normalizedUrl,
    excerpt = excerpt,
    wordCount = wordCount,
    favorite = favorite,
    status = status,
    wordCountMessage = wordCountMessage,
    image = image,
    hasImage = hasImage,
    hasVideo = hasVideo,
    hasAudio = hasAudio,
    sortId = sortId,
    timeAdded = timeAdded,
    timeUpdated = timeUpdated,
    timeRead = timeRead,
    timeFavorited = timeFavorited,
    timeToRead = timeToRead,
    listenDurationEstimate = listenDurationEstimate,
    text = text,
    articleId = articleId,
    resolved = resolved,
    deletedAt = deletedAt,
    archivedAt = archivedAt,
    textSource = textSource,
    backedUpAt = timeUpdated,
)

/** Missing → [default]; null → null; otherwise only a `String`. */
private fun Map<String, Any?>.wireString(name: String, default: String?): String? {
    if (!containsKey(name)) return default
    return when (val value = get(name)) {
        null -> null
        is String -> value
        else -> throw wrongType(name, value, "a string")
    }
}

/** Missing → [default]; null → null; otherwise a number within the 32-bit range, truncated. */
private fun Map<String, Any?>.wireInt(name: String, default: Int?): Int? {
    if (!containsKey(name)) return default
    return when (val value = get(name)) {
        null -> null
        is Int -> value
        is Long, is Double -> {
            val number = (value as Number).toDouble()
            require(number >= Int.MIN_VALUE && number <= Int.MAX_VALUE) {
                "Field $name: $value is out of the 32-bit integer range"
            }
            value.toInt()
        }
        else -> throw wrongType(name, value, "an int")
    }
}

/**
 * Missing → [default]; null → null; a [Timestamp] → its epoch milliseconds; otherwise a
 * number within the 64-bit range, truncated.
 */
private fun Map<String, Any?>.wireLong(name: String, default: Long?): Long? {
    if (!containsKey(name)) return default
    return when (val value = get(name)) {
        null -> null
        is Timestamp -> value.toDate().time
        is Int -> value.toLong()
        is Long -> value
        is Double -> {
            require(value >= Long.MIN_VALUE && value <= Long.MAX_VALUE) {
                "Field $name: $value is out of the 64-bit long range"
            }
            value.toLong()
        }
        else -> throw wrongType(name, value, "a long")
    }
}

/** Missing → [default]; null → null; otherwise only a `Boolean`. */
private fun Map<String, Any?>.wireBoolean(name: String, default: Boolean?): Boolean? {
    if (!containsKey(name)) return default
    return when (val value = get(name)) {
        null -> null
        is Boolean -> value
        else -> throw wrongType(name, value, "a boolean")
    }
}

private fun wrongType(name: String, value: Any, expected: String) =
    IllegalArgumentException("Field $name: a ${value.javaClass.name} cannot be read as $expected")

private fun nullIn(name: String): Nothing =
    throw IllegalArgumentException("Field $name: null cannot be read into a non-null field")
