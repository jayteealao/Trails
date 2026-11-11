package com.jayteealao.trails.data.archive

/**
 * The rank of the archives that can be the article text: Readability first, then AI
 * Markdown, then the renderer's Markdown (the whole page, with its menus and footers).
 *
 * Ranks archive keys rather than [ArchiveType] entries, so a text kind the server writes
 * ranks before the app stores it locally.
 *
 * A stored text whose source is not a ranked archive key is never replaced, so a text the
 * person wrote is kept. A stored text with no source (rows from before sources were
 * recorded) is replaced by any ranked source.
 */
object TextSourceRank {

    /** Archive keys of the text sources, best first, from [ArchiveType.textRank]. */
    val ORDER: List<String> = ArchiveType.entries
        .filter { it.textRank != null }
        .sortedBy { it.textRank }
        .map { it.archiveKey }

    /** 0 for the best text source; null when [key] is not a text source. */
    fun rankOf(key: String): Int? = ORDER.indexOf(key).takeIf { it >= 0 }

    /** The best-ranked text source among [keys], or null when none is a text source. */
    fun best(keys: Collection<String>): String? = ORDER.firstOrNull { it in keys }

    /**
     * Whether a text from [newSource] should replace the stored [currentText] from [currentSource].
     * A blank text never replaces: an empty extraction must not wipe a text that has words.
     */
    fun shouldReplace(currentText: String?, currentSource: String, newSource: String, newText: String): Boolean {
        if (newText.isBlank()) return false
        val newRank = rankOf(newSource) ?: return false
        if (currentText.isNullOrBlank() || currentSource.isEmpty()) return true
        val currentRank = rankOf(currentSource) ?: return false
        return newRank < currentRank || (newRank == currentRank && newText != currentText)
    }
}
