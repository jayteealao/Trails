package com.jayteealao.trails.screens.articleDetail

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.screens.theme.piazzollaFont
import com.mikepenz.markdown.compose.MarkdownElement
import com.mikepenz.markdown.compose.components.MarkdownComponent
import com.mikepenz.markdown.compose.components.MarkdownComponents
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownParagraph
import com.mikepenz.markdown.compose.elements.MarkdownText
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.MarkdownPadding
import com.mikepenz.markdown.model.MarkdownTypography
import com.mikepenz.markdown.model.State
import com.mikepenz.markdown.model.markdownPadding
import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes

/**
 * The heading scale of the reader text: Piazzolla SemiBold at 28 / 23 / 19 sp for `#` / `##` /
 * `###` (a fixed reading scale, ratio about 1.2), with balanced line breaks so a long title
 * wraps into even lines. `####` to `######` keep the face at the 16 sp body size. The body,
 * paragraphs and lists stay `bodyLarge` (16/24 sp).
 */
object ReaderTypeScale {
    val h1: TextStyle = heading(28, 36)
    val h2: TextStyle = heading(23, 30)
    val h3: TextStyle = heading(19, 26)
    val h4: TextStyle = heading(16, 24)
    val h5: TextStyle = heading(16, 24)
    val h6: TextStyle = heading(16, 24)

    private fun heading(size: Int, lineHeight: Int) = TextStyle(
        fontFamily = piazzollaFont,
        fontWeight = FontWeight.SemiBold,
        fontSize = size.sp,
        lineHeight = lineHeight.sp,
        lineBreak = LineBreak.Heading,
    )
}

/**
 * [markdown] without a leading YAML front matter block: a `---` line at the very start, `key:`
 * lines, and a closing `---` or `...` line. Converted Markdown can open with the page's title and
 * meta tags in such a block; the reader shows the article, not that block. The blank lines after
 * the block go too. Text that does not open with front matter (a thematic break, an unclosed
 * fence, a block that is not `key:` lines) is returned unchanged.
 */
fun withoutFrontMatter(markdown: String): String {
    val text = markdown.removePrefix("\uFEFF")
    val lines = text.split('\n')
    if (lines.size < 2 || lines[0].trimEnd() != "---") return markdown
    val close = (1 until lines.size).firstOrNull { lines[it].trimEnd().let { l -> l == "---" || l == "..." } }
        ?: return markdown
    val firstEntry = lines.subList(1, close).firstOrNull { it.isNotBlank() } ?: return markdown
    if (!FRONT_MATTER_KEY.containsMatchIn(firstEntry)) return markdown
    return lines.subList(close + 1, lines.size).joinToString("\n").trimStart('\r', '\n')
}

/** The first line of a front matter block: a YAML key, bare or quoted, then a colon. */
private val FRONT_MATTER_KEY = Regex("""^(?:[A-Za-z0-9_][\w.-]*|"[^"]+"|'[^']+')\s*:(?:\s|$)""")

/** The side gutter of the reading column on a phone. */
val READER_GUTTER: Dp = 16.dp

/** The widest the reading column grows; on a wider screen it is centred. */
val READER_MAX_WIDTH: Dp = 680.dp

/**
 * The space on each side of the reading column in a container [maxWidth] wide: the 16 dp gutter,
 * or more when the column would be wider than [READER_MAX_WIDTH], so the column stays centred.
 */
fun readerSidePadding(maxWidth: Dp): Dp = max(READER_GUTTER, (maxWidth - READER_MAX_WIDTH) / 2)

/**
 * The space between two top-level blocks of the reader text, [previous] (null for the first
 * block) and [next]. Block margins collapse as on the approved column: the gap is the larger of
 * the space below [previous] and the space above [next]. A heading has more space above it than
 * below it, so it sits with the text it introduces.
 */
fun readerBlockGap(previous: IElementType?, next: IElementType): Dp =
    max(previous?.let(::spaceBelow) ?: 0.dp, spaceAbove(next))

private fun spaceAbove(type: IElementType): Dp = when (type) {
    MarkdownElementTypes.ATX_1, MarkdownElementTypes.SETEXT_1 -> 8.dp
    MarkdownElementTypes.ATX_2, MarkdownElementTypes.SETEXT_2 -> 16.dp
    in MINOR_HEADINGS -> 12.dp
    else -> 0.dp
}

private fun spaceBelow(type: IElementType): Dp = when (type) {
    MarkdownElementTypes.ATX_2, MarkdownElementTypes.SETEXT_2 -> 8.dp
    in MINOR_HEADINGS -> 4.dp
    else -> 12.dp
}

private val MINOR_HEADINGS = setOf(
    MarkdownElementTypes.ATX_3,
    MarkdownElementTypes.ATX_4,
    MarkdownElementTypes.ATX_5,
    MarkdownElementTypes.ATX_6,
)

/** The renderer typography of the reader: [ReaderTypeScale] headings, `bodyLarge` text, links in the accent, underlined. */
@Composable
fun readerMarkdownTypography(): MarkdownTypography {
    val body = MaterialTheme.typography.bodyLarge
    return markdownTypography(
        h1 = ReaderTypeScale.h1,
        h2 = ReaderTypeScale.h2,
        h3 = ReaderTypeScale.h3,
        h4 = ReaderTypeScale.h4,
        h5 = ReaderTypeScale.h5,
        h6 = ReaderTypeScale.h6,
        text = body,
        paragraph = body,
        ordered = body,
        bullet = body,
        list = body,
        textLink = TextLinkStyles(
            SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)
        ),
    )
}

/**
 * The renderer padding of the reader: no block spacer, since [ReaderColumn] puts [readerBlockGap]
 * between the blocks; lists indented 24 dp with items 2 dp apart.
 */
@Composable
fun readerMarkdownPadding(): MarkdownPadding =
    markdownPadding(block = 0.dp, list = 0.dp, listItemTop = 2.dp, listItemBottom = 2.dp, listIndent = 24.dp)

/** The Markdown source of the column, for the alt text of an image inside running text. */
private val LocalReaderSource = staticCompositionLocalOf { "" }

private fun readerHeading(
    style: (MarkdownTypography) -> TextStyle,
    contentChildType: IElementType = MarkdownTokenTypes.ATX_CONTENT,
): MarkdownComponent = {
    MarkdownText(
        content = it.content,
        node = it.node,
        style = style(it.typography),
        modifier = Modifier.semantics { heading() },
        contentChildType = contentChildType,
    )
}

/**
 * The renderer components of the reader: headings keep their heading semantics; a paragraph that
 * holds only an image, and an image the renderer lifts to a block, show as a [ReaderFigure]; an
 * image inside running text shows the broken-image placeholder when it fails.
 */
fun readerMarkdownComponents(): MarkdownComponents = markdownComponents(
    heading1 = readerHeading({ it.h1 }),
    heading2 = readerHeading({ it.h2 }),
    heading3 = readerHeading({ it.h3 }),
    heading4 = readerHeading({ it.h4 }),
    heading5 = readerHeading({ it.h5 }),
    heading6 = readerHeading({ it.h6 }),
    setextHeading1 = readerHeading({ it.h1 }, MarkdownTokenTypes.SETEXT_CONTENT),
    setextHeading2 = readerHeading({ it.h2 }, MarkdownTokenTypes.SETEXT_CONTENT),
    paragraph = { model ->
        val figure = standaloneImageOf(model.node, model.content)
        if (figure != null) {
            ReaderFigure(figure)
        } else {
            MarkdownParagraph(model.content, model.node, style = model.typography.paragraph)
        }
    },
    image = { model -> imageRefOf(model.node, model.content)?.let { ReaderFigure(it) } },
    // The renderer passes the link as the content and the paragraph as the node.
    inlineImage = { model ->
        ReaderInlineImage(model.content, imageAltFor(model.content, model.node, LocalReaderSource.current))
    },
)

/**
 * The reading column: one lazy item per top-level block, so a very long article composes only
 * what is on screen; [readerBlockGap] above each block; the 16 dp gutter, widened so the column
 * is at most 680 dp and centred. The scroll area stays the full width.
 */
@Composable
fun ReaderColumn(state: State.Success, components: MarkdownComponents, modifier: Modifier = Modifier) {
    CompositionLocalProvider(LocalReaderSource provides state.content) {
        BoxWithConstraints(modifier.fillMaxSize()) {
            val side = readerSidePadding(maxWidth)
            val blocks = remember(state.node) {
                state.node.children.filter {
                    it.type != MarkdownTokenTypes.EOL && it.type != MarkdownTokenTypes.WHITE_SPACE
                }
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = side, end = side, top = 8.dp, bottom = 8.dp),
            ) {
                itemsIndexed(blocks, key = { _, node -> node.startOffset }, contentType = { _, node -> node.type }) { index, node ->
                    Column(Modifier.fillMaxWidth()) {
                        Spacer(Modifier.height(readerBlockGap(blocks.getOrNull(index - 1)?.type, node.type)))
                        MarkdownElement(node, components, state.content, includeSpacer = false)
                    }
                }
            }
        }
    }
}
