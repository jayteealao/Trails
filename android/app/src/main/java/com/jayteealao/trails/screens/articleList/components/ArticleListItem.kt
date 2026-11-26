package com.jayteealao.trails.screens.articleList.components

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import com.jayteealao.trails.screens.articleList.actions.ArticleAction
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
    onAction: (ArticleAction, ArticleItem) -> Unit = { _, _ -> },
    onLongPress: (ArticleItem) -> Unit = {},
) {
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

    // The article as the row shows it. An action toggles from it, so it is the state before the toggle.
    val shown = remember(article, isFavorite, isRead) {
        article.copy(favorite = isFavorite, isRead = isRead)
    }
    val act: (ArticleAction, ArticleItem) -> Unit = { action, item ->
        when (action) {
            ArticleAction.FAVOURITE -> isFavorite = !item.favorite
            ArticleAction.READ -> isRead = !item.isRead
            else -> Unit
        }
        onAction(action, item)
    }

    val tagStates: Map<String, Boolean> = remember(article.tagsString, tags) {
        val all = mutableMapOf<String, Boolean>()
        tags.forEach { all[it] = false }
        article.tags.forEach { all[it] = true }
        all
    }

    val colorScheme = MaterialTheme.colorScheme
    val parsedSnippet: AnnotatedString? = remember(article.snippet) {
        if (!article.snippet.isNullOrBlank()) {
            HtmlCompat.fromHtml(
                article.snippet,
                HtmlCompat.FROM_HTML_MODE_LEGACY
            ).toSpannable().toAnnotatedString(colorScheme.onSurface)
        } else {
            null
        }
    }
    val swipeState = rememberSwipeToDismissBoxState()
    val swipeScope = rememberCoroutineScope()

    LaunchedEffect(swipeState.currentValue) {
        when (swipeState.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> {
                // Perform action immediately
                act(ArticleAction.FAVOURITE, article.copy(favorite = isFavorite, isRead = isRead))

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
                article = shown,
                swipeState = swipeState,
                animationTrigger = animationTrigger,
                onAction = { action, item ->
                    // The list keeps the swipe position of a row by its key, so a row that Delete
                    // takes away would come back open on Undo: close it before it goes.
                    if (action == ArticleAction.DELETE) {
                        swipeScope.launch { swipeState.snapTo(SwipeToDismissBoxValue.Settled) }
                    }
                    act(action, item)
                },
            )
        }
    ) {
        if (useCardLayout) {

            ArticleItemCardStyle(
                article = shown,
                viewStore = viewStore,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                showAddTagDialog = onOpenTagManagement,
                onAction = act,
                onLongPress = onLongPress,
            )

        } else {
            ArticleContent( // non card item layout - legacy
                article = shown,
                viewStore = viewStore,
                parsedSnippet = parsedSnippet,
                tagStates = tagStates,
                onClick = onClick,
                filledStar = filledStar,
                outlinedStar = outlinedStar,
                showAddTagDialog = onOpenTagManagement,
                modifier = Modifier
                    .padding(start = 8.dp, end = 8.dp, top = 8.dp)
                    .background(colorScheme.surface)
                    .wrapContentHeight(),
                onAction = act,
                onLongPress = onLongPress,
            )
        }
    }
}

@Composable
fun <S : Any, E : Any, VM : Store<S, E>> ArticleItemCardStyle(
    article: ArticleItem,
    viewStore: ViewStore<S, E, VM>,
    parsedSnippet: AnnotatedString?,
    tagStates: Map<String, Boolean>,
    onClick: () -> Unit,
    filledStar: Painter,
    outlinedStar: Painter,
    showAddTagDialog: () -> Unit,
    onAction: (ArticleAction, ArticleItem) -> Unit = { _, _ -> },
    onLongPress: (ArticleItem) -> Unit = {},
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
            filledStar = filledStar,
            outlinedStar = outlinedStar,
            showAddTagDialog = showAddTagDialog,
            modifier = Modifier
                .padding(12.dp),
            onAction = onAction,
            onLongPress = onLongPress,
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

