package com.jayteealao.trails.screens.articleList.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.text.HtmlCompat
import androidx.core.text.toSpannable
import com.jayteealao.trails.R
import com.jayteealao.trails.common.ext.toAnnotatedString
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.ArticleListEvent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.Store
import io.yumemi.tartlet.ViewStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun <S : Any, E : Any, VM : Store<S, E>> ArticleListItem(
    article: ArticleItem,
    viewStore: ViewStore<S, E, VM>,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onOpenTagManagement: () -> Unit,
    useCardLayout: Boolean = false,
    tags: List<String> = emptyList(),
    onSetFavorite: (String, Boolean) -> Unit = { _, _ -> },
    onSetReadStatus: (String, Boolean) -> Unit = { _, _ -> },
    onArchiveArticle: (String) -> Unit = {},
    onDeleteArticle: (String) -> Unit = {},
    onRegenerateDetails: (String) -> Unit = {},
    onCopyLink: (String, String) -> Unit = { _, _ -> },
    onShareArticle: (String, String) -> Unit = { _, _ -> },
) {
    // State for palette colors
    var dominantColor by remember { mutableStateOf(Color.Transparent) }
    var vibrantColor by remember { mutableStateOf(Color.Transparent) }

//    val colors = extractPaletteFromBitmap()

    var isFavorite by remember(article.itemId) { mutableStateOf(article.favorite) }
    var animationTrigger by remember(article.itemId) { mutableStateOf(0) }

    LaunchedEffect(article.favorite) {
        isFavorite = article.favorite
    }

    var isRead by remember(article.itemId) { mutableStateOf(article.isRead) }
    LaunchedEffect(article.isRead) {
        isRead = article.isRead
    }

    val filledStar = painterResource(id = R.drawable.star_filled_24px)
    val outlinedStar = painterResource(id = R.drawable.star_24px)
    val markReadIcon = painterResource(id = R.drawable.check_24px)
    val markUnreadIcon = painterResource(id = R.drawable.close_24px)

    val tagStates = remember(article.itemId) { mutableStateMapOf<String, Boolean>() }
    LaunchedEffect(article.tagsString) {
        // Mark all known tags as absent until confirmed by the latest data snapshot
        tagStates.keys.toList().forEach { key ->
            tagStates[key] = false
        }
        article.tags.forEach { tag ->
            tagStates[tag] = true
        }
    }
    LaunchedEffect(article.itemId, tags) {
        tags.forEach { tag ->
            if (!tagStates.containsKey(tag)) {
                tagStates[tag] = false
            }
        }
    }

    // Animated gradient angle
    val infiniteTransition = rememberInfiniteTransition(label = "gradientTransition")
    val angle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(3000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "gradientAngle"
    )

    // Callback function to update palette colors
    val onPaletteExtracted: (Color, Color) -> Unit = { dominant, vibrant ->
        dominantColor = dominant
        vibrantColor = vibrant
    }

    DisposableEffect(article.itemId) {
        onDispose {
            dominantColor = Color.Transparent
            vibrantColor = Color.Transparent
        }
    }


    val colorScheme = MaterialTheme.colorScheme
    val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(
            article.snippet,
            HtmlCompat.FROM_HTML_MODE_LEGACY
        ).toSpannable().toAnnotatedString(colorScheme.onSurface)
    } else {
        null
    }
    val swipeState = rememberSwipeToDismissBoxState()

    LaunchedEffect(swipeState.currentValue) {
        when (swipeState.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> {
                // Perform action immediately
                val newFavorite = !isFavorite
                isFavorite = newFavorite
                onSetFavorite(article.itemId, newFavorite)

                // Trigger animation (increment counter so animation runs every time)
                animationTrigger++

                // Wait for animation to complete before resetting
                delay(400)
                swipeState.reset()
            }

            SwipeToDismissBoxValue.EndToStart -> {
                // Auto-reset after 5 seconds if no action taken
                launch {
                    delay(5000)
                    swipeState.reset()
                }
            }

            SwipeToDismissBoxValue.Settled -> {
                // Ensure card returns to original position when released without completing swipe
                swipeState.reset()
            }
        }
    }

    SwipeToDismissBox(
        modifier = modifier,
        state = swipeState,
        backgroundContent = {
            ArticleSwipeBackground(
                article = article,
                swipeState = swipeState,
                isFavorite = isFavorite,
                isRead = isRead,
                markReadIcon = markReadIcon,
                markUnreadIcon = markUnreadIcon,
                animationTrigger = animationTrigger,
                onSetReadStatus = onSetReadStatus,
                onArchiveArticle = onArchiveArticle,
                onDeleteArticle = onDeleteArticle,
                onRegenerateDetails = onRegenerateDetails,
                onCopyLink = onCopyLink,
                onShareArticle = onShareArticle
            )
        }
    ) {
        if (useCardLayout) {

            ArticleItemCardStyle(
                article = article,
                viewStore = viewStore,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                onFavoriteToggleLocal = { checked -> isFavorite = checked },
                isFavorite = isFavorite,
                isRead = isRead,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                onPaletteExtracted = onPaletteExtracted,
                showAddTagDialog = onOpenTagManagement,
                onSetFavorite = onSetFavorite
            )

        } else {
            ArticleContent( // non card item layout - legacy
                article = article,
                viewStore = viewStore,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                onFavoriteToggleLocal = { checked -> isFavorite = checked },
                isFavorite = isFavorite,
                isRead = isRead,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                dominantColor = dominantColor,
                vibrantColor = vibrantColor,
                onPaletteExtracted = onPaletteExtracted,
                showAddTagDialog = onOpenTagManagement,
                modifier = Modifier
                    .padding(start = 8.dp, end = 8.dp, top = 8.dp)
                    .background(colorScheme.surface)
                    .wrapContentHeight(),
                onSetFavorite = onSetFavorite
            )
        }
    }
}

@Composable
fun <S : Any, E : Any, VM : Store<S, E>> ArticleItemCardStyle(
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
    onSetFavorite: (String, Boolean) -> Unit = { _, _ -> }
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp),
        elevation = CardDefaults.cardElevation(
            defaultElevation = 4.dp,
            pressedElevation = 8.dp
        ),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        ArticleContent(
            article = article,
            viewStore = viewStore,
            parsedSnippet = parsedSnippet,
            tagStates = tagStates,
            onClick = onClick,
            onFavoriteToggleLocal = onFavoriteToggleLocal,
            isFavorite = isFavorite,
            isRead = isRead,
            filledStar = filledStar,
            outlinedStar = outlinedStar,
            dominantColor = dominantColor,
            vibrantColor = vibrantColor,
            onPaletteExtracted = onPaletteExtracted,
            showAddTagDialog = showAddTagDialog,
            modifier = Modifier
                .padding(12.dp),
            onSetFavorite = onSetFavorite
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Preview
@Composable
fun ArticleListItemPreview() {
    val article = ArticleItem(
        itemId = "123",
        title = "A long and interesting article title that might wrap to two lines",
        url = "https://example.com/article",
        image = "https://picsum.photos/80/80",
        favorite = true,
        tagsString = "android,jetpack,compose",
        snippet = "This is a short snippet of the article content. It provides a brief overview of what the article is about. <b>Bold text</b> is also supported."
    )
    TrailsTheme {
        ArticleListItem(
            article = article,
            viewStore = ViewStore {
                com.jayteealao.trails.screens.articleList.ArticleListState(
                    tags = listOf("compose", "android", "kotlin")
                )
            },
            onClick = {},
            onOpenTagManagement = {},
            useCardLayout = true,
            tags = listOf("compose", "android", "kotlin")
        )
    }
}

