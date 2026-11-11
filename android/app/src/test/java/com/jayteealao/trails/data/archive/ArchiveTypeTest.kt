package com.jayteealao.trails.data.archive

import com.jayteealao.trails.screens.articleDetail.icon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArchiveTypeTest {

    @Test
    fun `the AI Markdown archive key is the one the server writes`() {
        assertEquals("ai_markdown", ArchiveType.AI_MARKDOWN_ARCHIVE_KEY)
    }

    // The AI Markdown archive is now a local type with its own tab.
    @Test
    fun `the AI Markdown archive key resolves to the AI Markdown type`() {
        assertEquals(ArchiveType.AI_MARKDOWN, ArchiveType.fromArchiveKey(ArchiveType.AI_MARKDOWN_ARCHIVE_KEY))
    }

    @Test
    fun `the AI Markdown type is a Markdown text source stored gzipped`() {
        val type = ArchiveType.AI_MARKDOWN
        assertEquals("ai_markdown", type.archiveKey)
        assertEquals("text/markdown", type.contentType)
        assertTrue(type.providesText)
        assertEquals("AI Markdown", type.displayName)
        assertEquals("ai_markdown.gz", type.localFilename)
    }

    @Test
    fun `every existing archive key still resolves to its type`() {
        assertEquals(ArchiveType.SINGLEFILE, ArchiveType.fromArchiveKey("singlefile"))
        assertEquals(ArchiveType.MONOLITH, ArchiveType.fromArchiveKey("monolith"))
        assertEquals(ArchiveType.READABILITY, ArchiveType.fromArchiveKey("readability"))
        assertEquals(ArchiveType.MARKDOWN, ArchiveType.fromArchiveKey("markdown"))
        assertEquals(ArchiveType.RENDERED, ArchiveType.fromArchiveKey("rendered"))
    }

    @Test
    fun `the tab order is fixed by kind and holds every type once`() {
        assertEquals(
            listOf(
                ArchiveType.READABILITY,
                ArchiveType.AI_MARKDOWN,
                ArchiveType.MARKDOWN,
                ArchiveType.SINGLEFILE,
                ArchiveType.MONOLITH,
                ArchiveType.RENDERED,
            ),
            ArchiveType.TAB_ORDER,
        )
        assertEquals(ArchiveType.entries.toSet(), ArchiveType.TAB_ORDER.toSet())
        assertEquals(ArchiveType.entries.size, ArchiveType.TAB_ORDER.size)
    }

    @Test
    fun `inTabOrder sorts known keys and drops unknown and repeated ones`() {
        val keys = listOf(
            "rendered", "monolith", "markdown", "pdf", "singlefile", "ai_markdown", "readability", "markdown",
        )
        assertEquals(ArchiveType.TAB_ORDER, ArchiveType.inTabOrder(keys))
    }

    @Test
    fun `the AI Markdown icon differs from the Markdown icon`() {
        assertNotEquals(ArchiveType.MARKDOWN.icon, ArchiveType.AI_MARKDOWN.icon)
    }

    @Test
    fun `every tab icon sits on the 24 unit grid`() {
        ArchiveType.entries.forEach { type ->
            assertEquals("${type.name} viewport width", 24f, type.icon.viewportWidth)
            assertEquals("${type.name} viewport height", 24f, type.icon.viewportHeight)
        }
    }
}
