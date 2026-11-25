package com.jayteealao.trails.screens.share

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A web link that another app shared, and the title that came with it, which may be blank. */
data class SharedLink(val url: String, val title: String) {
    /** The link without its scheme, to show while there is no title. */
    val address: String get() = url.substringAfter("://")

    val host: String get() = url.toHttpUrlOrNull()?.host ?: address
}

/** An http or https address that does not continue a longer word, up to a space, a quote or an angle bracket. */
private val ADDRESS = Regex(
    """(?<![A-Za-z0-9+\-/])https?://[^\s\p{Z}"“”„«»「」『』《》〈〉<>]+""",
    RegexOption.IGNORE_CASE,
)

private const val TRAILING_PUNCTUATION = ".,;:!?'’…。，、；：！？"

private val BRACKETS = mapOf(')' to '(', ']' to '[', '}' to '{', '）' to '（')

/**
 * The first web address in [text] that can be opened, or null when there is none. The title is
 * [title], else the words before the address.
 */
fun sharedLink(text: String?, title: String?): SharedLink? {
    if (text == null) return null
    for (match in ADDRESS.findAll(text)) {
        val url = match.value.withoutTrailingPunctuation()
        if (url.toHttpUrlOrNull() == null) continue
        val words = title?.trim().orEmpty().ifEmpty { text.substring(0, match.range.first).trim() }
        return SharedLink(url, words)
    }
    return null
}

/** The address without the punctuation of the sentence around it; a bracket stays when the address opens it. */
private fun String.withoutTrailingPunctuation(): String {
    var end = length
    while (end > 0) {
        val last = this[end - 1]
        val opening = BRACKETS[last]
        val drop = if (opening == null) {
            last in TRAILING_PUNCTUATION
        } else {
            val address = substring(0, end)
            address.count { it == last } > address.count { it == opening }
        }
        if (!drop) break
        end--
    }
    return substring(0, end)
}
