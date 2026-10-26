package com.jayteealao.trails.data.archive

import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages

// Pure rules that turn Warg's archive metadata into the article's image and
// author rows and pick the displayed article image. No Android, Firestore or
// Room call lives here.

/** Image row id of the page lead image (rows are keyed by imageId and itemId). */
const val LEAD_IMAGE_ID = "lead"

/** Author row id of the byline; per article, because author rows are keyed by authorId alone. */
fun bylineAuthorId(itemId: String) = "$itemId:byline"

/** How far back the background metadata pass looks for newly saved articles. */
const val WARG_METADATA_WINDOW_MS = 7L * 24 * 60 * 60 * 1000

/** Checks of one article's Warg metadata before the background pass stops asking. */
const val WARG_METADATA_MAX_CHECKS = 5

/** Wait before the second check; each later check waits four times longer. */
const val WARG_METADATA_FIRST_WAIT_MS = 15L * 60 * 1000

/**
 * True when the background pass may check an article again, given [checks] made so far,
 * the last one at [lastCheckAt]. Warg archives an article some time after it is saved,
 * so checks back off (15 min, 1 h, 4 h, 16 h) and stop after [WARG_METADATA_MAX_CHECKS].
 */
fun wargMetadataCheckDue(checks: Int, lastCheckAt: Long, now: Long): Boolean {
    if (checks <= 0) return true
    if (checks >= WARG_METADATA_MAX_CHECKS) return false
    var wait = WARG_METADATA_FIRST_WAIT_MS
    repeat(checks - 1) { wait *= 4 }
    return now - lastCheckAt >= wait
}

/** The trimmed lead image when it is a non-blank http(s) URL, else null. */
fun usableLeadImage(raw: String?): String? {
    val value = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val lower = value.lowercase()
    return value.takeIf { lower.startsWith("https://") || lower.startsWith("http://") }
}

fun leadImageRow(itemId: String, leadImage: String) = ArticleImages(
    imageId = LEAD_IMAGE_ID,
    itemId = itemId,
    src = leadImage,
    width = 0,
    height = 0,
    credit = "",
    caption = "",
)

/** One row for the whole byline, several names included. */
fun bylineAuthorRow(itemId: String, byline: String) = ArticleAuthors(
    authorId = bylineAuthorId(itemId),
    itemId = itemId,
    name = byline.trim(),
    url = "",
    domain = null,
    image = null,
    bio = null,
    twitter = null,
)

/** Which image the article shows after the metadata is applied. */
sealed interface ImageChoice {
    data class UseLeadImage(val url: String) : ImageChoice
    data object UseScreenshot : ImageChoice
    data object Keep : ImageChoice
}

/** The rows to write (only missing or changed ones) and the image choice. */
data class WargRowsPlan(
    val images: List<ArticleImages>,
    val authors: List<ArticleAuthors>,
    val image: ImageChoice,
)

/**
 * Lead-image-first rule: rows imported before Warg keep the current image; a
 * usable lead image is shown; with no lead image, a blank image takes the
 * archived screenshot and any other image stays.
 */
fun chooseArticleImage(
    currentImage: String?,
    leadImage: String?,
    hasImportedImageRows: Boolean,
): ImageChoice = when {
    hasImportedImageRows -> ImageChoice.Keep
    leadImage != null -> if (currentImage == leadImage) ImageChoice.Keep else ImageChoice.UseLeadImage(leadImage)
    currentImage.isNullOrBlank() -> ImageChoice.UseScreenshot
    else -> ImageChoice.Keep
}

/**
 * Plan the rows and the image for [itemId] from [metadata]. A row is written
 * when no row with its id exists or the stored one differs; it is skipped when
 * the article already has a row of that kind with another id (imported rows).
 */
fun planWargRows(
    itemId: String,
    metadata: WargMetadata,
    currentImage: String?,
    existingImages: List<ArticleImages>,
    existingAuthors: List<ArticleAuthors>,
): WargRowsPlan {
    val lead = usableLeadImage(metadata.leadImage)
    val hasImportedImageRows = existingImages.any { it.imageId != LEAD_IMAGE_ID }
    val images = if (lead != null && !hasImportedImageRows) {
        val row = leadImageRow(itemId, lead)
        if (existingImages.none { it == row }) listOf(row) else emptyList()
    } else {
        emptyList()
    }

    val authorId = bylineAuthorId(itemId)
    val byline = metadata.byline?.trim()?.takeIf { it.isNotEmpty() }
    val hasImportedAuthorRows = existingAuthors.any { it.authorId != authorId }
    val authors = if (byline != null && !hasImportedAuthorRows) {
        val row = bylineAuthorRow(itemId, byline)
        if (existingAuthors.none { it == row }) listOf(row) else emptyList()
    } else {
        emptyList()
    }

    return WargRowsPlan(images, authors, chooseArticleImage(currentImage, lead, hasImportedImageRows))
}
