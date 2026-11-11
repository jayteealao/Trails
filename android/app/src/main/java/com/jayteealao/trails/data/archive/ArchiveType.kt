package com.jayteealao.trails.data.archive

/**
 * The 6 archive types stored locally as gzipped files, each with its tab on the article
 * detail screen. PDF and screenshot are excluded — screenshot is only used for image fallback.
 */
enum class ArchiveType(
    val archiveKey: String,
    val contentType: String,
    val providesText: Boolean,
    val displayName: String,
) {
    SINGLEFILE("singlefile", "text/html", false, "SingleFile"),
    MONOLITH("monolith", "text/html", false, "Monolith"),
    READABILITY("readability", "text/markdown", true, "Readability"),
    MARKDOWN("markdown", "text/markdown", true, "Markdown"),
    RENDERED("rendered", "text/html", false, "Rendered"),
    // The literal, not AI_MARKDOWN_ARCHIVE_KEY: an entry cannot read the companion, which is
    // initialized after the entries.
    AI_MARKDOWN("ai_markdown", "text/markdown", true, "AI Markdown");

    companion object {
        /** The archive key the server writes for the AI Markdown archive: the key of [AI_MARKDOWN]. */
        const val AI_MARKDOWN_ARCHIVE_KEY = "ai_markdown"

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
