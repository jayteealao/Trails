package com.jayteealao.trails.data.archive

import androidx.compose.ui.graphics.vector.ImageVector
import compose.icons.CssGgIcons
import compose.icons.cssggicons.Components
import compose.icons.cssggicons.Ereader
import compose.icons.cssggicons.FileDocument
import compose.icons.cssggicons.Hashtag
import compose.icons.cssggicons.Screen

/**
 * The 5 archive types stored locally as gzipped files.
 * PDF and screenshot are excluded — screenshot is only used for image fallback.
 */
enum class ArchiveType(
    val archiveKey: String,
    val contentType: String,
    val providesText: Boolean,
    val displayName: String,
    val icon: ImageVector,
) {
    SINGLEFILE("singlefile", "text/html", false, "SingleFile", CssGgIcons.FileDocument),
    MONOLITH("monolith", "text/html", false, "Monolith", CssGgIcons.Components),
    READABILITY("readability", "text/markdown", true, "Readability", CssGgIcons.Ereader),
    MARKDOWN("markdown", "text/markdown", true, "Markdown", CssGgIcons.Hashtag),
    RENDERED("rendered", "text/html", false, "Rendered", CssGgIcons.Screen);

    companion object {
        fun fromArchiveKey(key: String): ArchiveType? = entries.find { it.archiveKey == key }
    }

    /** Local filename — always stored gzipped locally. */
    val localFilename: String get() = "${archiveKey}.gz"
}
