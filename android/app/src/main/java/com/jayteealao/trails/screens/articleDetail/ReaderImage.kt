package com.jayteealao.trails.screens.articleDetail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import com.jayteealao.trails.data.archive.ArchiveTabIcons
import org.intellij.markdown.IElementType
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.ast.getTextInNode

/** An image of the reader text: where it loads from and its text alternative. */
data class ImageRef(val link: String, val alt: String?)

/**
 * The image of [paragraph] when the paragraph holds one image and nothing else but blanks, so it
 * shows as a figure at the full column width; null for any other paragraph.
 */
fun standaloneImageOf(paragraph: ASTNode, content: String): ImageRef? {
    val parts = paragraph.children.filterNot {
        it.type == MarkdownTokenTypes.WHITE_SPACE || it.type == MarkdownTokenTypes.EOL ||
            (it.type == MarkdownTokenTypes.TEXT && it.getTextInNode(content).isBlank())
    }
    val image = parts.singleOrNull()?.takeIf { it.type == MarkdownElementTypes.IMAGE } ?: return null
    return imageRefOf(image, content)
}

/** The link and alt text of an `IMAGE` node, or null when it has no link. */
fun imageRefOf(image: ASTNode, content: String): ImageRef? =
    image.linkOf(content)?.let { ImageRef(link = it, alt = image.altOf(content)) }

/** The alt text of the first image under [node] that loads from [link], or null. */
fun imageAltFor(link: String, node: ASTNode, content: String): String? =
    node.imageOf(link, content)?.altOf(content)

/** The words of the broken-image placeholder: they name the image by its alt text when it has one. */
fun brokenImageLabel(alt: String?): String =
    if (alt.isNullOrBlank()) "Image did not load" else "Image did not load: ${alt.trim()}"

private fun ASTNode.imageOf(link: String, content: String): ASTNode? =
    if (type == MarkdownElementTypes.IMAGE && linkOf(content) == link) this
    else children.firstNotNullOfOrNull { it.imageOf(link, content) }

private fun ASTNode.linkOf(content: String): String? =
    descendant(MarkdownElementTypes.LINK_DESTINATION)?.getTextInNode(content)?.toString()

private fun ASTNode.altOf(content: String): String? =
    descendant(MarkdownElementTypes.LINK_TEXT)?.getTextInNode(content)?.toString()
        ?.trim('[', ']')?.trim()?.takeIf { it.isNotEmpty() }

private fun ASTNode.descendant(type: IElementType): ASTNode? =
    children.firstNotNullOfOrNull { if (it.type == type) it else it.descendant(type) }

/** The icons of the reader text, on the same outline grid as the tab icons. */
object ReaderIcons {
    /** A picture crossed through: an image that did not load. */
    val BrokenImage: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon(
            "BrokenImage",
            "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
            "m3 16 5-5 5 5M14 14l2-2 5 5M3 3l18 18",
        )
    }
}

/**
 * The place of an image that did not load: a dashed hairline box with a crossed-picture icon and
 * "Image did not load: <alt text>", in the secondary text colour. It reads as one image with that
 * label to assistive technology.
 */
@Composable
fun BrokenImagePlaceholder(alt: String?, modifier: Modifier = Modifier) {
    val label = brokenImageLabel(alt)
    val colors = MaterialTheme.colorScheme
    val border = colors.outlineVariant
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .drawBehind {
                val stroke = 1.dp.toPx()
                drawRect(
                    color = border,
                    topLeft = Offset(stroke / 2, stroke / 2),
                    size = Size(size.width - stroke, size.height - stroke),
                    style = Stroke(
                        width = stroke,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx())),
                    ),
                )
            }
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Image
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ReaderIcons.BrokenImage, contentDescription = null, modifier = Modifier.size(18.dp), tint = colors.onSurfaceVariant)
        Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp), color = colors.onSurfaceVariant)
    }
}

/**
 * An image on its own line of the reader text: the full column width with the height from its
 * ratio; a 16:9 box in the surface variant while it loads, so the text does not jump; the
 * broken-image placeholder when it fails.
 */
@Composable
fun ReaderFigure(ref: ImageRef, modifier: Modifier = Modifier) {
    SubcomposeAsyncImage(
        model = ref.link,
        contentDescription = ref.alt,
        modifier = modifier.fillMaxWidth(),
        contentScale = ContentScale.FillWidth,
        loading = {
            Box(
                Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
            )
        },
        error = { BrokenImagePlaceholder(ref.alt) },
    )
}

/** An image inside running text, in the box the renderer sizes for it; the placeholder when it fails. */
@Composable
fun ReaderInlineImage(link: String, alt: String?) {
    SubcomposeAsyncImage(
        model = link,
        contentDescription = alt,
        modifier = Modifier.fillMaxSize(),
        contentScale = ContentScale.Fit,
        error = { BrokenImagePlaceholder(alt) },
    )
}
