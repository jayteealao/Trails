package com.jayteealao.trails.services.firestore

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

    companion object {
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
