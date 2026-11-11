package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArticleDetailTabsTest {

    private fun labels(keys: Collection<String>) = detailTabsFor(keys).map { it.label }

    @Test
    fun `an article with every local archive shows the tabs in the fixed order by kind`() {
        val keys = listOf("rendered", "singlefile", "markdown", "pdf", "monolith", "ai_markdown", "readability")
        assertEquals(
            listOf("Reader", "Web", "Readability", "AI Markdown", "Markdown", "SingleFile", "Monolith", "Rendered"),
            labels(keys),
        )
    }

    @Test
    fun `an article with no archive yet shows Reader and Web`() {
        assertEquals(listOf("Reader", "Web"), labels(emptyList()))
    }

    @Test
    fun `an article with only the renderer Markdown shows its tab after Web`() {
        assertEquals(listOf("Reader", "Web", "Markdown"), labels(listOf("markdown")))
    }

    @Test
    fun `Readability takes its place before Markdown when it arrives later`() {
        assertEquals(listOf("Reader", "Web", "Readability", "Markdown"), labels(listOf("markdown", "readability")))
    }

    @Test
    fun `a new AI Markdown tab takes its fixed place before Markdown`() {
        assertEquals(listOf("Reader", "Web", "AI Markdown", "Markdown"), labels(listOf("markdown", "ai_markdown")))
    }

    @Test
    fun `Reader and Web carry no archive and every other tab carries its type`() {
        val tabs = detailTabsFor(listOf("markdown", "readability", "ai_markdown"))
        assertNull(tabs[READER_TAB_INDEX].archiveType)
        assertNull(tabs[WEB_TAB_INDEX].archiveType)
        assertEquals(
            listOf(ArchiveType.READABILITY, ArchiveType.AI_MARKDOWN, ArchiveType.MARKDOWN),
            tabs.drop(FIRST_ARCHIVE_TAB_INDEX).map { it.archiveType },
        )
        tabs.drop(FIRST_ARCHIVE_TAB_INDEX).forEach { tab ->
            assertEquals(tab.archiveType!!.displayName, tab.label)
            assertEquals(tab.archiveType!!.icon, tab.icon)
        }
    }

    @Test
    fun `an archive ready on the server has a tab before it lands, one still being made has none`() {
        val remote = mapOf(
            "readability" to ArchiveStatus("success", "gs://x/readability"),
            "markdown" to ArchiveStatus("success", "gs://x/markdown"),
            "monolith" to ArchiveStatus("processing", null),
            "singlefile" to ArchiveStatus("success", null),
        )
        val keys = tabArchiveKeys(localKeys = listOf("markdown"), remote = remote)
        assertEquals(listOf("markdown", "readability"), keys)
        assertEquals(listOf("Reader", "Web", "Readability", "Markdown"), labels(keys))
    }

    @Test
    fun `the AI Markdown tab has its own icon, not the Markdown one`() {
        val tabs = detailTabsFor(listOf("markdown", "ai_markdown")).associateBy { it.label }
        assertNotEquals(tabs.getValue("Markdown").icon, tabs.getValue("AI Markdown").icon)
    }
}
