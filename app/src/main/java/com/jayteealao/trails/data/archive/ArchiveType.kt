package com.jayteealao.trails.data.archive

/**
 * The 5 archive types stored locally as gzipped files.
 * PDF and screenshot are excluded — screenshot is only used for image fallback.
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
    RENDERED("rendered", "text/html", false, "Rendered");

    companion object {
        fun fromArchiveKey(key: String): ArchiveType? = entries.find { it.archiveKey == key }
    }

    /** Local filename — always stored gzipped locally. */
    val localFilename: String get() = "${archiveKey}.gz"
}
