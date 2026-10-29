package com.jayteealao.trails.services.firestore

import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * The image, author and video rows of one article, as the backup writes them and the
 * restore reads them back.
 */
data class ArticleRows(
    val images: List<ArticleImages> = emptyList(),
    val authors: List<ArticleAuthors> = emptyList(),
    val videos: List<ArticleVideos> = emptyList(),
) {
    /** One Firestore doc per row. */
    val writeCount: Int get() = images.size + authors.size + videos.size

    fun isEmpty(): Boolean = writeCount == 0
}

/**
 * The Firestore doc id for a row id. URL-encoding keeps a `/` from nesting the path.
 * Firestore also refuses the ids `.`, `..` and `__…__`, which URL-encoding leaves
 * as they are, so those characters are escaped too. [URLDecoder] reverses every case.
 */
internal fun rowDocId(id: String): String {
    val encoded = URLEncoder.encode(id, "UTF-8")
    return when {
        encoded == "." || encoded == ".." -> encoded.replace(".", "%2E")
        encoded.length >= 4 && encoded.startsWith("__") && encoded.endsWith("__") ->
            encoded.replace("_", "%5F")
        else -> encoded
    }
}

private fun idFromDocId(docId: String): String = URLDecoder.decode(docId, "UTF-8")

internal fun ArticleImages.toFirestoreFields(): Map<String, Any?> = mapOf(
    "imageId" to imageId,
    "itemId" to itemId,
    "src" to src,
    "width" to width,
    "height" to height,
    "credit" to credit,
    "caption" to caption,
)

internal fun ArticleAuthors.toFirestoreFields(): Map<String, Any?> = mapOf(
    "authorId" to authorId,
    "itemId" to itemId,
    "name" to name,
    "url" to url,
    "domain" to domain,
    "image" to image,
    "bio" to bio,
    "twitter" to twitter,
)

internal fun ArticleVideos.toFirestoreFields(): Map<String, Any?> = mapOf(
    "videoId" to videoId,
    "itemId" to itemId,
    "src" to src,
    "width" to width,
    "height" to height,
    "type" to type,
    "vid" to vid,
    "duration" to duration,
    "image" to image,
)

/**
 * Read an image row from a stored doc. The parent article id [itemId] wins over a
 * stored one. Returns null when the doc has no usable `src`.
 */
internal fun imageFromFirestore(docId: String, data: Map<String, Any?>, itemId: String): ArticleImages? {
    val src = (data["src"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    return ArticleImages(
        imageId = data["imageId"] as? String ?: idFromDocId(docId),
        itemId = itemId,
        src = src,
        width = (data["width"] as? Number)?.toInt() ?: 0,
        height = (data["height"] as? Number)?.toInt() ?: 0,
        credit = data["credit"] as? String ?: "",
        caption = data["caption"] as? String ?: "",
    )
}

/**
 * Read an author row from a stored doc. The parent article id [itemId] wins over a
 * stored one. Returns null when the doc has no usable `name`.
 */
internal fun authorFromFirestore(docId: String, data: Map<String, Any?>, itemId: String): ArticleAuthors? {
    val name = (data["name"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    return ArticleAuthors(
        authorId = data["authorId"] as? String ?: idFromDocId(docId),
        itemId = itemId,
        name = name,
        url = data["url"] as? String ?: "",
        domain = data["domain"] as? String,
        image = data["image"] as? String,
        bio = data["bio"] as? String,
        twitter = data["twitter"] as? String,
    )
}

/**
 * Read a video row from a stored doc, as [imageFromFirestore] reads images. Returns null
 * when the doc has no usable `src`.
 */
internal fun videoFromFirestore(docId: String, data: Map<String, Any?>, itemId: String): ArticleVideos? {
    val src = (data["src"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    return ArticleVideos(
        videoId = data["videoId"] as? String ?: idFromDocId(docId),
        itemId = itemId,
        src = src,
        width = (data["width"] as? Number)?.toInt() ?: 0,
        height = (data["height"] as? Number)?.toInt() ?: 0,
        type = data["type"] as? String ?: "",
        vid = data["vid"] as? String ?: "",
        duration = (data["duration"] as? Number)?.toInt(),
        image = data["image"] as? String,
    )
}

/**
 * Read a tag from a stored tag doc (written from [ArticleTags] by the object mapper, so
 * its fields are itemId, tag, sortId and type). The object mapper cannot read it back:
 * [ArticleTags] has no no-argument constructor. The parent article id [itemId] wins over a
 * stored one. Returns null when the doc has no usable `tag`.
 */
internal fun tagFromFirestore(data: Map<String, Any?>, itemId: String): ArticleTags? {
    val tag = (data["tag"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    return ArticleTags(
        itemId = itemId,
        tag = tag,
        sortId = (data["sortId"] as? Number)?.toInt(),
        type = data["type"] as? String,
    )
}

/** Group rows by article id; articles without rows are absent. */
internal fun groupRows(
    images: List<ArticleImages>,
    authors: List<ArticleAuthors>,
    videos: List<ArticleVideos> = emptyList(),
): Map<String, ArticleRows> {
    val imagesById = images.groupBy { it.itemId }
    val authorsById = authors.groupBy { it.itemId }
    val videosById = videos.groupBy { it.itemId }
    return (imagesById.keys + authorsById.keys + videosById.keys).associateWith { id ->
        ArticleRows(imagesById[id].orEmpty(), authorsById[id].orEmpty(), videosById[id].orEmpty())
    }
}
