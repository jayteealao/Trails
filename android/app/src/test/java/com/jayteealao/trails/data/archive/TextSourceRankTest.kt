package com.jayteealao.trails.data.archive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The rank of the text sources: Readability first, then AI Markdown, then the renderer's
 * Markdown, and the rule that decides when an arriving text replaces the stored one.
 */
class TextSourceRankTest {

    @Test
    fun order_isReadabilityThenAiMarkdownThenMarkdown() {
        assertEquals(listOf("readability", "ai_markdown", "markdown"), TextSourceRank.ORDER)
    }

    @Test
    fun rankOf_ranksTheTextSources() {
        assertEquals(0, TextSourceRank.rankOf("readability"))
        assertEquals(1, TextSourceRank.rankOf("ai_markdown"))
        assertEquals(2, TextSourceRank.rankOf("markdown"))
    }

    @Test
    fun rankOf_isNullForNonTextSources() {
        assertNull(TextSourceRank.rankOf("rendered"))
        assertNull(TextSourceRank.rankOf("singlefile"))
        assertNull(TextSourceRank.rankOf("monolith"))
        assertNull(TextSourceRank.rankOf("user"))
    }

    @Test
    fun best_picksTheBestRankedKey() {
        assertEquals("readability", TextSourceRank.best(listOf("markdown", "ai_markdown", "readability")))
        assertNull(TextSourceRank.best(listOf("rendered")))
    }

    @Test
    fun shouldReplace_blankCurrent_isTrue() {
        assertTrue(TextSourceRank.shouldReplace(null, "", "markdown", "new"))
        assertTrue(TextSourceRank.shouldReplace("  ", "readability", "markdown", "new"))
    }

    @Test
    fun shouldReplace_aiMarkdownDoesNotReplaceReadability() {
        assertFalse(TextSourceRank.shouldReplace("r", "readability", "ai_markdown", "a"))
    }

    @Test
    fun shouldReplace_markdownDoesNotReplaceReadability() {
        assertFalse(TextSourceRank.shouldReplace("r", "readability", "markdown", "m"))
    }

    @Test
    fun shouldReplace_readabilityReplacesMarkdown() {
        assertTrue(TextSourceRank.shouldReplace("m", "markdown", "readability", "r"))
    }

    @Test
    fun shouldReplace_readabilityReplacesAiMarkdown() {
        assertTrue(TextSourceRank.shouldReplace("a", "ai_markdown", "readability", "r"))
    }

    @Test
    fun shouldReplace_aiMarkdownReplacesMarkdown() {
        assertTrue(TextSourceRank.shouldReplace("m", "markdown", "ai_markdown", "a"))
    }

    @Test
    fun shouldReplace_sameSourceSameText_isFalse() {
        assertFalse(TextSourceRank.shouldReplace("r", "readability", "readability", "r"))
    }

    @Test
    fun shouldReplace_sameSourceOtherText_isTrue() {
        assertTrue(TextSourceRank.shouldReplace("r1", "readability", "readability", "r2"))
    }

    @Test
    fun shouldReplace_legacyRowWithoutSource_isReplaced() {
        assertTrue(TextSourceRank.shouldReplace("old text", "", "markdown", "m"))
    }

    @Test
    fun shouldReplace_textWithUnrankedSource_isKept() {
        assertFalse(TextSourceRank.shouldReplace("my edit", "user", "readability", "r"))
    }

    @Test
    fun shouldReplace_newSourceNotText_isFalse() {
        assertFalse(TextSourceRank.shouldReplace(null, "", "rendered", "<html>"))
    }

    /** The rank names exactly the archive kinds that the cross-stack contract marks as text. */
    @Test
    fun order_matchesTheTextRowsOfTheContract() {
        val contract = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "shared-types/WargMetadata.md") }
            .first { it.isFile }
        val table = contract.readLines()
            .dropWhile { it.trim() != "## Archive kinds" }
            .drop(1)
            .takeWhile { !it.startsWith("## ") }
            .filter { it.trimStart().startsWith("| `") }
        val textKeys = table.mapNotNull { row ->
            val cells = row.split("|").map { it.trim() }.drop(1)
            if (cells.getOrNull(3) == "yes") cells[0].trim('`') else null
        }
        assertEquals(TextSourceRank.ORDER.toSet(), textKeys.toSet())
    }
}
