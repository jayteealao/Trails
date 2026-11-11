package com.jayteealao.trails.data.archive

/**
 * The 6 archive types stored locally as gzipped files, each with its tab on the article
 * detail screen. PDF and screenshot are excluded — screenshot is only used for image fallback.
 */
enum class ArchiveType(
    val archiveKey: String,
    val contentType: String,
    /**
     * The rank of a text source, 0 the best (see [TextSourceRank]); null for an archive that is
     * not article text. The one place a text source and its rank are stated.
     */
    val textRank: Int?,
    val displayName: String,
) {
    SINGLEFILE("singlefile", "text/html", null, "SingleFile"),
    MONOLITH("monolith", "text/html", null, "Monolith"),
    READABILITY("readability", "text/markdown", 0, "Readability"),
    MARKDOWN("markdown", "text/markdown", 2, "Markdown"),
    RENDERED("rendered", "text/html", null, "Rendered"),
    AI_MARKDOWN("ai_markdown", "text/markdown", 1, "AI Markdown");

    /** Whether this archive can be the article text. */
    val providesText: Boolean get() = textRank != null

    companion object {
        /** The archive key the server writes for the AI Markdown archive: the key of [AI_MARKDOWN]. */
        val AI_MARKDOWN_ARCHIVE_KEY: String get() = AI_MARKDOWN.archiveKey

        /**
         * The fixed order by kind of the detail screen's archive tabs, after Reader and Web.
         * A new archive takes its place here, so an archive that arrives later never reorders
         * the tabs that are already shown.
         */
        val TAB_ORDER: List<ArchiveType> = listOf(READABILITY, AI_MARKDOWN, MARKDOWN, SINGLEFILE, MONOLITH, RENDERED)

        fun fromArchiveKey(key: String): ArchiveType? = entries.find { it.archiveKey == key }

        /** The types of [archiveKeys] in [TAB_ORDER]; unknown keys and repeats are dropped. */
        fun inTabOrder(archiveKeys: Collection<String>): List<ArchiveType> =
            TAB_ORDER.filter { it.archiveKey in archiveKeys }
    }

    /** Local filename — always stored gzipped locally. */
    val localFilename: String get() = "${archiveKey}.gz"
}
