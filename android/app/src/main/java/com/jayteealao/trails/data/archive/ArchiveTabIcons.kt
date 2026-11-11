package com.jayteealao.trails.data.archive

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The outline icons of the article detail tabs, drawn on the 24 dp Material Symbols grid with a
 * round-capped 2-unit stroke and no fill. `Icon` tints them with its content colour, so the
 * selected tab draws in the accent and the others in the secondary text colour.
 */
object ArchiveTabIcons {

    /** Lines of text: the Reader tab. */
    val Reader: ImageVector by lazy {
        outlineIcon("Reader", "M5 6h14M5 10h14M5 14h14M5 18h9")
    }

    /** A globe: the Web tab. */
    val Web: ImageVector by lazy {
        outlineIcon(
            "Web",
            "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0z",
            "M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18",
        )
    }

    /** An open book: the Readability archive. */
    val Readability: ImageVector by lazy {
        outlineIcon(
            "Readability",
            "M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z",
        )
    }

    /**
     * A page marked with "M" and a down arrow: the AI Markdown archive. The mark is in the same
     * 2-unit stroke as every other tab icon, as the approved row draws it.
     */
    val AiMarkdown: ImageVector by lazy {
        outlineIcon("AiMarkdown", "M6 3h8l4 4v14H6z", "M9 16v-5l2 2.5 2-2.5v5M15.5 12v4m-1.5-1.5 1.5 1.5 1.5-1.5")
    }

    /** A hash sign: the renderer's Markdown archive. */
    val Markdown: ImageVector by lazy {
        outlineIcon("Markdown", "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16")
    }

    /** A page with a folded corner: the SingleFile archive. */
    val SingleFile: ImageVector by lazy {
        outlineIcon("SingleFile", "M6 3h8l4 4v14H6z M14 3v4h4")
    }

    /** A box: the Monolith archive. */
    val Monolith: ImageVector by lazy {
        outlineIcon("Monolith", "m12 3 8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5M12 12v9")
    }

    /** A screen on a stand: the Rendered archive. */
    val Rendered: ImageVector by lazy {
        outlineIcon(
            "Rendered",
            "M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
            "M8 20h8M12 16v4",
        )
    }

    internal fun outlineIcon(name: String, vararg paths: String): ImageVector =
        paths.fold(ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)) { builder, path ->
            builder.outlinePath(path, strokeWidth = 2f)
        }.build()

    private fun ImageVector.Builder.outlinePath(pathData: String, strokeWidth: Float): ImageVector.Builder =
        addPath(
            pathData = PathParser().parsePathString(pathData).toNodes(),
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = strokeWidth,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
}
