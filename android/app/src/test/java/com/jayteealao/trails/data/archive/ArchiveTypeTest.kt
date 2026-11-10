package com.jayteealao.trails.data.archive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArchiveTypeTest {

    @Test
    fun `the AI Markdown archive key is the one the server writes`() {
        assertEquals("ai_markdown", ArchiveType.AI_MARKDOWN_ARCHIVE_KEY)
    }

    @Test
    fun `the AI Markdown archive is not yet a local archive type`() {
        assertNull(ArchiveType.fromArchiveKey(ArchiveType.AI_MARKDOWN_ARCHIVE_KEY))
    }

    @Test
    fun `every existing archive key still resolves to its type`() {
        assertEquals(ArchiveType.SINGLEFILE, ArchiveType.fromArchiveKey("singlefile"))
        assertEquals(ArchiveType.MONOLITH, ArchiveType.fromArchiveKey("monolith"))
        assertEquals(ArchiveType.READABILITY, ArchiveType.fromArchiveKey("readability"))
        assertEquals(ArchiveType.MARKDOWN, ArchiveType.fromArchiveKey("markdown"))
        assertEquals(ArchiveType.RENDERED, ArchiveType.fromArchiveKey("rendered"))
    }
}
