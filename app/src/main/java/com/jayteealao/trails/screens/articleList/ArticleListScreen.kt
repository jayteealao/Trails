/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.jayteealao.trails.screens.articleList

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemContentType
import androidx.paging.compose.itemKey
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.screens.articleList.components.ArticleDialog
import com.jayteealao.trails.screens.articleList.components.ArticleListItem
import com.jayteealao.trails.screens.preview.rememberPreviewArticles
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.launch


@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(
    modifier: Modifier = Modifier,
    articleListViewModel: ArticleListViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Create ViewStore from ViewModel
    val viewStore = rememberViewStore { articleListViewModel }

    // Collect paging flows separately (not part of consolidated state)
    val articles = articleListViewModel.articles.collectAsLazyPagingItems()
    val favoriteArticles = articleListViewModel.favoriteArticles.collectAsLazyPagingItems()
    val archivedArticles = articleListViewModel.archivedArticles.collectAsLazyPagingItems()
    val taggedArticles = articleListViewModel.taggedArticles.collectAsLazyPagingItems()

    // Handle events
    viewStore.handle<ArticleListEvent.NavigateToArticle> { event ->
        // Navigation handled by parent if needed
    }

    viewStore.handle<ArticleListEvent.ShowSnackbar> { event ->
        scope.launch {
            snackbarHostState.showSnackbar(event.message)
        }
    }

    viewStore.handle<ArticleListEvent.ShowToast> { event ->
        scope.launch {
            snackbarHostState.showSnackbar(event.message)
        }
    }

    viewStore.handle<ArticleListEvent.ShowError> { event ->
        scope.launch {
            snackbarHostState.showSnackbar("Error: ${event.error.message}")
        }
    }

    viewStore.handle<ArticleListEvent.ShareArticle> { event ->
        val sendIntent = Intent().apply {
            action = Intent.ACTION_SEND
            putExtra(Intent.EXTRA_TEXT, "${event.title}\n\n${event.url}")
            type = "text/plain"
        }
        val shareIntent = Intent.createChooser(sendIntent, "Share article")
        context.startActivity(shareIntent)
    }

    viewStore.handle<ArticleListEvent.CopyLink> { event ->
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText(event.label, event.url)
        clipboard.setPrimaryClip(clip)
        scope.launch {
            snackbarHostState.showSnackbar("${event.label} copied to clipboard")
        }
    }

    LaunchedEffect(viewStore.state.selectedTab) {
        if (viewStore.state.selectedTab != ArticleListTab.TAGS) {
            viewStore.action { selectTag(null) }
        }
    }

    Column(
        modifier = modifier.fillMaxSize()
    ) {
        AnimatedVisibility(
            visible = viewStore.state.databaseSync,
            modifier = Modifier.padding(0.dp)
            ) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(0.dp),
                strokeCap = StrokeCap.Square,
            )
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            when (viewStore.state.selectedTab) {
                ArticleListTab.HOME -> ArticleListScreenContent(
                    lazyItems = articles,
                    viewStore = viewStore,
                    onSelectArticle = onSelectArticle,
                    onOpenTagManagement = onOpenTagManagement,
                    useCardLayout = useCardLayout
                )

                ArticleListTab.FAVOURITES -> ArticleListScreenContent(
                    lazyItems = favoriteArticles,
                    viewStore = viewStore,
                    onSelectArticle = onSelectArticle,
                    onOpenTagManagement = onOpenTagManagement,
                    useCardLayout = useCardLayout
                )

                ArticleListTab.ARCHIVE -> ArticleListScreenContent(
                    lazyItems = archivedArticles,
                    viewStore = viewStore,
                    onSelectArticle = onSelectArticle,
                    onOpenTagManagement = onOpenTagManagement,
                    useCardLayout = useCardLayout
                )

                ArticleListTab.TAGS -> TagsContent(
                    viewStore = viewStore,
                    lazyItems = taggedArticles,
                    onSelectArticle = onSelectArticle,
                    onOpenTagManagement = onOpenTagManagement,
                    useCardLayout = useCardLayout
                )
            }
            ArticleDialog( // remove dialog or add to swipe buttons
                article = viewStore.state.selectedArticle.copy(snippet = viewStore.state.selectedArticleSummary.summary),
                showDialog = viewStore.state.selectedArticle != EMPTYARTICLEITEM,
                onDismissRequest = { viewStore.action { selectArticle(EMPTYARTICLEITEM) } }
            )

        }
        NavigationBar(
            modifier = Modifier
                .wrapContentHeight(Alignment.Bottom)
                .windowInsetsPadding(WindowInsets.navigationBars),
            containerColor = MaterialTheme.colorScheme.surface,
//                .height(64.dp)
        ) {
            ArticleListTab.entries.forEach { tab ->
                NavigationBarItem(
                    selected = viewStore.state.selectedTab == tab,
                    onClick = { viewStore.action { setSelectedTab(tab) } },
                    icon = tab.icon,
                    label = { Text(text = tab.label) }
                )
            }
        }
    }

}

@Preview(name = "Articles • Light", showBackground = true)
@Composable
private fun ArticleListScreenPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleListScreenContent(
            lazyItems = rememberPreviewArticles(),
            viewStore = ViewStore {
                ArticleListState(
                    sortOption = ArticleSortOption.Newest,
                    tags = listOf("compose", "kotlin", "android"),
                    selectedTab = ArticleListTab.HOME
                )
            },
            onSelectArticle = {},
            onOpenTagManagement = {},
            useCardLayout = true
        )
    }
}

@Preview(
    name = "Articles • Dark",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleListScreenDarkPreview() {
    TrailsTheme(darkTheme = true) {
        ArticleListScreenContent(
            lazyItems = rememberPreviewArticles(),
            viewStore = ViewStore {
                ArticleListState(
                    sortOption = ArticleSortOption.Newest,
                    tags = listOf("compose", "kotlin", "android"),
                    selectedTab = ArticleListTab.HOME
                )
            },
            onSelectArticle = {},
            onOpenTagManagement = {},
            useCardLayout = true
        )
    }
}


@Composable
private fun TagsContent(
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    lazyItems: LazyPagingItems<ArticleItem>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
) {
    val tags = viewStore.state.tags
    val selectedTag = viewStore.state.selectedTag

    if (selectedTag == null) {
        if (tags.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surface),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No tags yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surface)
            ) {
                items(tags) { tag ->
                    Text(
                        text = tag,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewStore.action { selectTag(tag) } }
                            .padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                }
            }
        }
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = selectedTag,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                TextButton(onClick = { viewStore.action { selectTag(null) } }) {
                    Text(text = "All tags")
                }
            }
            Box(modifier = Modifier.weight(1f)) {
                ArticleListScreenContent(
                    lazyItems = lazyItems,
                    viewStore = viewStore,
                    onSelectArticle = onSelectArticle,
                    onOpenTagManagement = onOpenTagManagement,
                    useCardLayout = useCardLayout
                )
            }
        }
    }
}


@Composable
internal fun ArticleListScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
) {
    val listState = rememberLazyListState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize(),
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


