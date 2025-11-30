package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.ArticleListEvent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import io.yumemi.tartlet.Store
import io.yumemi.tartlet.ViewStore

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <S : Any, E : Any, VM : Store<S, E>> ArticleContent(
    article: ArticleItem,
    viewStore: ViewStore<S, E, VM>,
    parsedSnippet: AnnotatedString?,
    tagStates: MutableMap<String, Boolean>,
    onClick: () -> Unit,
    onFavoriteToggleLocal: (Boolean) -> Unit,
    isFavorite: Boolean,
    isRead: Boolean,
    filledStar: Painter,
    outlinedStar: Painter,
    dominantColor: Color,
    vibrantColor: Color,
    onPaletteExtracted: (Color, Color) -> Unit,
    showAddTagDialog: () -> Unit,
    modifier: Modifier = Modifier,
    onSetFavorite: (String, Boolean) -> Unit = { _, _ -> }
) {
    val colorScheme = MaterialTheme.colorScheme
    val titleColor = if (isRead) {
        colorScheme.onSurface.copy(alpha = 0.5f)  // Stronger dimming: 50% opacity
    } else {
        colorScheme.onSurface
    }
    val domainColor = if (isRead) {
        colorScheme.onSurfaceVariant.copy(alpha = 0.5f)  // Stronger dimming: 50% opacity
    } else {
        colorScheme.onSurfaceVariant
    }
    val snippetColor = if (isRead) {
        colorScheme.onSurfaceVariant.copy(alpha = 0.5f)  // Stronger dimming: 50% opacity
    } else {
        colorScheme.onSurfaceVariant
    }
    val thumbnailAlpha = if (isRead) 0.3f else 1f  // Much more faded: 30% opacity
    Column(
        modifier = modifier
            .clickable { onClick() }
    ) {
        Row(
            modifier = Modifier
                .wrapContentHeight(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            ArticleThumbnail(
                article = article,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                onPaletteExtracted = onPaletteExtracted,
                modifier = Modifier.align(Alignment.CenterVertically)
                    .graphicsLayer { alpha = thumbnailAlpha }
            )

            Spacer(modifier = Modifier.width(16.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .align(Alignment.CenterVertically)
            ) {
                Text(
                    modifier = Modifier
                        .wrapContentHeight()
                        .padding(end = 8.dp),
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontSize = 16.sp,
                    color = titleColor
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        modifier = Modifier.align(Alignment.CenterVertically),
                        text = article.domain,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        color = domainColor,
                        overflow = TextOverflow.Ellipsis,
                        fontSize = 10.sp
                    )
                    IconToggleButton(
                        modifier = Modifier.size(24.dp),
                        checked = isFavorite,
                        onCheckedChange = { checked ->
                            onFavoriteToggleLocal(checked)
                            onSetFavorite(article.itemId, checked)
                        }
                    ) {
                        Icon(
                            painter = if (isFavorite) filledStar else outlinedStar,
                            contentDescription = if (isFavorite) {
                                "Remove from favorites"
                            } else {
                                "Add to favorites"
                            },
                            tint = if (isFavorite) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        if (!parsedSnippet.isNullOrBlank()) {
            Text(
                text = parsedSnippet,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                color = snippetColor
            )
        }
        TagSection(
            tagStates = tagStates,
            onTagToggle = { _, _ ->
                // Tag management removed from article list - use dedicated tag management screen
            },
            onAddTag = showAddTagDialog,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp)
        )
        HorizontalDivider(
            modifier = Modifier
                .background(colorScheme.surface)
                .padding(horizontal = 16.dp)
                .fillMaxWidth(),
            thickness = 1.dp,
            color = colorScheme.outlineVariant
        )
    }
}
