package com.jayteealao.trails.screens.articleList.actions

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.piazzollaFont

private const val DISABLED_ALPHA = 0.38f

private val TitleStyle = TextStyle(
    fontFamily = piazzollaFont,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
)

private val ArticleSheet.title: String
    get() = article.title.ifBlank { "Article actions" }

/**
 * The actions of one article in a bottom sheet; a null [sheet] hides it. The last article stays in
 * it while it goes, so nothing in it changes on the way out.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleActionsSheet(
    sheet: ArticleSheet?,
    onChoose: (ArticleAction) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var leaving by remember { mutableStateOf<ArticleSheet?>(null) }

    LaunchedEffect(sheet) {
        if (sheet != null) {
            leaving = sheet
            // Opened again while the sheet before it was still on its way out.
            if (sheetState.isVisible) sheetState.show()
        } else if (leaving != null) {
            try {
                sheetState.hide()
            } finally {
                leaving = null
            }
        }
    }

    val shown = sheet ?: leaving ?: return
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = Modifier.semantics { paneTitle = shown.title },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        dragHandle = null,
    ) {
        ArticleActionsSheetContent(shown, onChoose)
    }
}

/** The title and host of the article, the line of a failure, and one row for each action. */
@Composable
fun ArticleActionsSheetContent(
    sheet: ArticleSheet,
    onChoose: (ArticleAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val small = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 20.sp)
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(top = 24.dp, bottom = 12.dp)
    ) {
        Text(
            text = sheet.title,
            modifier = Modifier
                .padding(start = 24.dp, end = 24.dp, bottom = 4.dp)
                .semantics { heading() },
            style = TitleStyle,
            color = colors.onSurface,
        )
        Text(
            text = sheet.article.webHost ?: "No web address saved",
            modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 12.dp),
            style = small,
            color = colors.onSurfaceVariant,
        )
        if (sheet.failure != null) {
            Text(
                text = sheet.failure,
                modifier = Modifier
                    .padding(start = 24.dp, end = 24.dp, bottom = 8.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                style = small,
                color = colors.error,
            )
        }
        articleActions(sheet.article, sheet.regenerating).forEach { item ->
            ActionRow(item, onClick = { onChoose(item.action) })
        }
    }
}

@Composable
private fun ActionRow(item: ArticleActionItem, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = item.enabled, role = Role.Button, onClick = onClick)
            .heightIn(min = 48.dp)
            .padding(horizontal = 24.dp, vertical = 4.dp)
            .alpha(if (item.enabled) 1f else DISABLED_ALPHA),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = item.painter(),
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = if (item.isError) colors.error else colors.primary,
        )
        Text(
            text = item.label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            color = if (item.isError) colors.error else colors.onSurface,
        )
    }
}

private val PREVIEW_ARTICLE =
    ArticleItem("preview", "Counting the street trees of a small city", "https://example.org/trees")

@Composable
private fun SheetPreview(sheet: ArticleSheet, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            ArticleActionsSheetContent(sheet, onChoose = {})
        }
    }
}

@Preview(name = "Article actions • light", widthDp = 411)
@Composable
private fun ArticleActionsLightPreview() = SheetPreview(ArticleSheet(PREVIEW_ARTICLE))

@Preview(name = "Article actions • dark", widthDp = 411, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ArticleActionsDarkPreview() =
    SheetPreview(ArticleSheet(PREVIEW_ARTICLE.copy(favorite = true, isRead = true)), darkTheme = true)

@Preview(name = "Article actions • no web address", widthDp = 411)
@Composable
private fun ArticleActionsEmptyPreview() =
    SheetPreview(ArticleSheet(PREVIEW_ARTICLE.copy(title = "Notes from the tree survey", url = "")))

@Preview(name = "Article actions • details load", widthDp = 411)
@Composable
private fun ArticleActionsLoadingPreview() = SheetPreview(ArticleSheet(PREVIEW_ARTICLE, regenerating = true))

@Preview(name = "Article actions • not saved", widthDp = 411)
@Composable
private fun ArticleActionsErrorPreview() = SheetPreview(
    ArticleSheet(
        PREVIEW_ARTICLE,
        failure = "Add to favourites was not saved on this phone. Choose it again to retry.",
    ),
)

@Preview(name = "Article actions • long words", widthDp = 360)
@Composable
private fun ArticleActionsWorstPreview() = SheetPreview(
    ArticleSheet(
        ArticleItem(
            itemId = "worst",
            title = "Benachrichtigungseinstellungen and other compound words: how Aleksandra " +
                "Wiśniewska-Kowalczyk rebuilt a forty-year-old newsletter in one very long summer",
            url = "https://reading-room.archive.the-longest-subdomain-in-the-list.example.org/a",
        ),
    ),
)
