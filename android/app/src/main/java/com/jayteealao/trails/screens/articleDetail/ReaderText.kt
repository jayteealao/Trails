package com.jayteealao.trails.screens.articleDetail

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.screens.theme.piazzollaFont
import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes

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
