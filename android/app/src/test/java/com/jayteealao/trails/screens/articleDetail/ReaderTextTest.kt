package com.jayteealao.trails.screens.articleDetail

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.screens.theme.piazzollaFont
import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** The reading scale (28 / 23 / 19 sp Piazzolla SemiBold), the block gaps and the column width. */
class ReaderTextTest {

    private fun assertHeading(style: TextStyle, size: Int, lineHeight: Int) {
        assertSame(piazzollaFont, style.fontFamily)
        assertEquals(FontWeight.SemiBold, style.fontWeight)
        assertEquals(size.sp, style.fontSize)
        assertEquals(lineHeight.sp, style.lineHeight)
        assertEquals(LineBreak.Heading, style.lineBreak)
    }

    @Test
    fun `the title is Piazzolla SemiBold 28 on 36 sp with balanced breaks`() {
        assertHeading(ReaderTypeScale.h1, 28, 36)
    }

    @Test
    fun `a second-level heading is 23 on 30 sp`() {
        assertHeading(ReaderTypeScale.h2, 23, 30)
    }

    @Test
    fun `a third-level heading is 19 on 26 sp`() {
        assertHeading(ReaderTypeScale.h3, 19, 26)
    }

    @Test
    fun `the lower headings keep the face at the body size`() {
        listOf(ReaderTypeScale.h4, ReaderTypeScale.h5, ReaderTypeScale.h6).forEach { assertHeading(it, 16, 24) }
    }

    @Test
    fun `the heading sizes rise by about 1_2 per step`() {
        val sizes = listOf(ReaderTypeScale.h3, ReaderTypeScale.h2, ReaderTypeScale.h1).map { it.fontSize.value }
        sizes.zipWithNext().forEach { (lower, higher) ->
            val ratio = higher / lower
            assertTrue("ratio $ratio between $lower and $higher sp", ratio in 1.17f..1.23f)
        }
    }

    private fun gap(previous: IElementType?, next: IElementType): Dp = readerBlockGap(previous, next)

    @Test
    fun `the gap between two blocks is the larger of their margins`() {
        val e = MarkdownElementTypes
        assertEquals(8.dp, gap(null, e.ATX_1))
        assertEquals(12.dp, gap(e.ATX_1, e.PARAGRAPH))
        assertEquals(12.dp, gap(e.PARAGRAPH, e.PARAGRAPH))
        assertEquals(16.dp, gap(e.PARAGRAPH, e.ATX_2))
        assertEquals(8.dp, gap(e.ATX_2, e.PARAGRAPH))
        assertEquals(12.dp, gap(e.PARAGRAPH, e.ATX_3))
        assertEquals(4.dp, gap(e.ATX_3, e.PARAGRAPH))
        assertEquals(12.dp, gap(e.PARAGRAPH, e.UNORDERED_LIST))
        assertEquals(16.dp, gap(e.UNORDERED_LIST, e.ATX_2))
        assertEquals(12.dp, gap(e.ORDERED_LIST, e.PARAGRAPH))
        assertEquals(0.dp, gap(null, e.PARAGRAPH))
    }

    @Test
    fun `every heading has more space above it than below it`() {
        val e = MarkdownElementTypes
        listOf(e.ATX_2, e.ATX_3, e.SETEXT_2).forEach { heading ->
            assertTrue("$heading", gap(e.PARAGRAPH, heading) > gap(heading, e.PARAGRAPH))
        }
    }

    @Test
    fun `the column keeps a 16 dp gutter and centres at 680 dp`() {
        assertEquals(16.dp, READER_GUTTER)
        assertEquals(680.dp, READER_MAX_WIDTH)
        assertEquals(16.dp, readerSidePadding(411.dp))
        assertEquals(16.dp, readerSidePadding(712.dp))
        assertEquals(85.5.dp, readerSidePadding(851.dp))
        assertEquals(110.dp, readerSidePadding(900.dp))
        assertEquals(300.dp, readerSidePadding(1280.dp))
    }

    @Test
    fun `a leading front matter block with nested meta is not drawn`() {
        val markdown = """
            ---
            title: "It was all the things - by Sean Trende - Poll Vault"
            meta:
              author: Sean Trende
              "og:title": It was all the things
              "twitter:title": It was all the things
            ---

            # It was all the things

            The first paragraph.
        """.trimIndent()
        assertEquals("# It was all the things\n\nThe first paragraph.", withoutFrontMatter(markdown))
    }

    @Test
    fun `front matter with CRLF lines, a byte order mark or a dot-dot-dot close is not drawn`() {
        assertEquals("Body\r\n", withoutFrontMatter("\uFEFF---\r\ntitle: A\r\n---\r\n\r\nBody\r\n"))
        assertEquals("Body", withoutFrontMatter("---\ntitle: A\n...\nBody"))
    }

    @Test
    fun `text without front matter is unchanged`() {
        val plain = "# Title\n\nA paragraph.\n\n---\n\nAfter a rule."
        assertSame(plain, withoutFrontMatter(plain))
        // A thematic break at the top, then prose: not front matter.
        val rule = "---\nJust a line of prose.\n---\nMore."
        assertSame(rule, withoutFrontMatter(rule))
        // An unclosed fence is left alone.
        val unclosed = "---\ntitle: A\nBody with no close"
        assertSame(unclosed, withoutFrontMatter(unclosed))
        assertSame("", withoutFrontMatter(""))
    }

    @Test
    fun `a text tab holding only front matter shows the empty notice`() {
        assertEquals(
            ReaderBody.Notice(ReaderNoticeKind.EMPTY),
            archiveTabBodyFor("---\ntitle: A\n---\n", loadFailed = false),
        )
    }
}
