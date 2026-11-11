// Fixture: the app archive types, as the drift check reads them.
package com.jayteealao.trails.data.archive

enum class ArchiveType(val archiveKey: String) {
    SINGLEFILE("singlefile"),
    MONOLITH("monolith"),
    READABILITY("readability"),
    MARKDOWN("markdown"),
    RENDERED("rendered");

    companion object {
        const val AI_MARKDOWN_ARCHIVE_KEY = "ai_markdown"
    }
}
