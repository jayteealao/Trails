package com.jayteealao.trails.screens.articleList.actions

import androidx.annotation.DrawableRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import com.jayteealao.trails.R
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleDetail.ArchiveTabIcons
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Everything a row of articles can do besides opening, in the order of the actions sheet. */
enum class ArticleAction { FAVOURITE, READ, ARCHIVE, OPEN, SHARE, COPY_LINK, REGENERATE, DELETE }

/** One action of one article, as it is offered now. */
data class ArticleActionItem(
    val action: ArticleAction,
    val label: String,
    /** The drawable of the action; null only for [ArticleAction.OPEN], which is drawn in code. */
    @param:DrawableRes val icon: Int?,
    val enabled: Boolean = true,
    val isError: Boolean = false,
)

/**
 * The one list of actions. The sheet shows it, the swipe row shows a part of it, and screen readers
 * get its enabled actions, so a label or a rule cannot differ between them.
 */
fun articleActions(article: ArticleItem, regenerating: Boolean = false): List<ArticleActionItem> {
    val hasLink = article.webHost != null
    return ArticleAction.entries.map { action ->
        when (action) {
            ArticleAction.FAVOURITE ->
                if (article.favorite) {
                    ArticleActionItem(action, "Remove from favourites", R.drawable.star_filled_24px)
                } else {
                    ArticleActionItem(action, "Add to favourites", R.drawable.star_24px)
                }

            ArticleAction.READ ->
                if (article.isRead) {
                    ArticleActionItem(action, "Mark as unread", R.drawable.close_24px)
                } else {
                    ArticleActionItem(action, "Mark as read", R.drawable.check_24px)
                }

            ArticleAction.ARCHIVE -> ArticleActionItem(action, "Archive", R.drawable.archive_icon_24)
            ArticleAction.OPEN -> ArticleActionItem(action, "Open in browser", icon = null, enabled = hasLink)
            ArticleAction.SHARE -> ArticleActionItem(action, "Share", R.drawable.share_24px, enabled = hasLink)
            ArticleAction.COPY_LINK -> ArticleActionItem(action, "Copy link", R.drawable.link_24px, enabled = hasLink)
            ArticleAction.REGENERATE -> ArticleActionItem(
                action = action,
                label = if (regenerating) "Regenerating details…" else "Regenerate details",
                icon = R.drawable.refresh_24px,
                enabled = !regenerating,
            )

            ArticleAction.DELETE -> ArticleActionItem(action, "Delete", R.drawable.delete_24px, isError = true)
        }
    }
}

/** The host of the web address, or null when the address is not one that a browser can open. */
val ArticleItem.webHost: String?
    get() = url.toHttpUrlOrNull()?.host

/** A square with an arrow that leaves it, as the approved sheet draws Open in browser. */
private val OpenIcon: ImageVector by lazy {
    ArchiveTabIcons.outlineIcon("OpenInBrowser", "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6")
}

@Composable
fun ArticleActionItem.painter(): Painter =
    icon?.let { painterResource(it) } ?: rememberVectorPainter(OpenIcon)
