package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.itemContentType
import androidx.paging.compose.itemKey
import androidx.window.core.layout.WindowSizeClass.Companion.WIDTH_DP_MEDIUM_LOWER_BOUND
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.ArticleListEvent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import io.yumemi.tartlet.ViewStore

/**
 * Determines if grid layout should be used based on window width.
 * Uses WIDTH_DP_MEDIUM_LOWER_BOUND (600dp) as the breakpoint.
 */
@Composable
fun shouldUseGridLayout(): Boolean {
    val windowSizeClass = currentWindowAdaptiveInfo().windowSizeClass
    return windowSizeClass.isWidthAtLeastBreakpoint(WIDTH_DP_MEDIUM_LOWER_BOUND)
}

/**
 * Adaptive article list that switches between LazyColumn and LazyVerticalGrid
 * based on screen width. Provides responsive layout for optimal content density.
 */
@Composable
fun AdaptiveArticleGrid(
    lazyItems: LazyPagingItems<ArticleItem>,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    modifier: Modifier = Modifier,
) {
    val useGridLayout = shouldUseGridLayout()

    if (useGridLayout) {
        ArticleGrid(
            lazyItems = lazyItems,
            viewStore = viewStore,
            onSelectArticle = onSelectArticle,
            onOpenTagManagement = onOpenTagManagement,
            useCardLayout = useCardLayout,
            modifier = modifier
        )
    } else {
        ArticleList(
            lazyItems = lazyItems,
            viewStore = viewStore,
            onSelectArticle = onSelectArticle,
            onOpenTagManagement = onOpenTagManagement,
            useCardLayout = useCardLayout,
            modifier = modifier
        )
    }
}

/**
 * Grid layout for articles using LazyVerticalGrid with adaptive column sizing.
 * Each article maintains a minimum width of 300dp for optimal readability.
 */
@Composable
private fun ArticleGrid(
    lazyItems: LazyPagingItems<ArticleItem>,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    modifier: Modifier = Modifier,
) {
    val gridState = rememberLazyGridState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 300.dp),
            state = gridState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(
                count = lazyItems.itemCount,
                key = lazyItems.itemKey { it.itemId },
                contentType = lazyItems.itemContentType { "article" }
            ) { index ->
                val article = lazyItems[index]
                if (article != null) {
                    ArticleListItem<ArticleListState, ArticleListEvent, ArticleListViewModel>(
                        article = article,
                        viewStore = viewStore,
                        modifier = Modifier
                            .animateItem()
                            .fillMaxWidth(),
                        onClick = { onSelectArticle(article) },
                        onOpenTagManagement = { onOpenTagManagement(article) },
                        useCardLayout = useCardLayout,
                        tags = viewStore.state.tags,
                        onSetFavorite = { itemId, isFavorite ->
                            viewStore.action { setFavorite(itemId, isFavorite) }
                        },
                        onSetReadStatus = { itemId, isRead ->
                            viewStore.action { setReadStatus(itemId, isRead) }
                        },
                        onArchiveArticle = { itemId ->
                            viewStore.action { archiveArticle(itemId) }
                        },
                        onDeleteArticle = { itemId ->
                            viewStore.action { deleteArticle(itemId) }
                        },
                        onRegenerateDetails = { itemId ->
                            viewStore.action { regenerateArticleDetails(itemId) }
                        },
                        onCopyLink = { url, label ->
                            viewStore.action { copyLink(url, label) }
                        },
                        onShareArticle = { title, url ->
                            viewStore.action { shareArticle(title, url) }
                        }
                    )
                }
            }
        }
    }
}

/**
 * Single column layout for articles using LazyColumn.
 * Maintains existing behavior for compact screens.
 */
@Composable
private fun ArticleList(
    lazyItems: LazyPagingItems<ArticleItem>,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = 16.dp,
                bottom = 16.dp,
                start = if (useCardLayout) 16.dp else 0.dp,
                end = if (useCardLayout) 16.dp else 0.dp
            )
        ) {
            items(
                count = lazyItems.itemCount,
                key = lazyItems.itemKey { it-> it.itemId },
                contentType = lazyItems.itemContentType { "article" }
            ) { index ->
                val article = lazyItems[index]
                if (article != null) {
                    ArticleListItem<ArticleListState, ArticleListEvent, ArticleListViewModel>(
                        article = article,
                        viewStore = viewStore,
                        modifier = Modifier.animateItem().then(
                            if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier
                        ),
                        onClick = { onSelectArticle(article) },
                        onOpenTagManagement = { onOpenTagManagement(article) },
                        useCardLayout = useCardLayout,
                        tags = viewStore.state.tags,
                        onSetFavorite = { itemId, isFavorite -> viewStore.action { setFavorite(itemId, isFavorite) } },
                        onSetReadStatus = { itemId, isRead -> viewStore.action { setReadStatus(itemId, isRead) } },
                        onArchiveArticle = { itemId -> viewStore.action { archiveArticle(itemId) } },
                        onDeleteArticle = { itemId -> viewStore.action { deleteArticle(itemId) } },
                        onRegenerateDetails = { itemId -> viewStore.action { regenerateArticleDetails(itemId) } },
                        onCopyLink = { url, label -> viewStore.action { copyLink(url, label) } },
                        onShareArticle = { title, url -> viewStore.action { shareArticle(title, url) } }
                    )
                }
            }
        }
    }
}