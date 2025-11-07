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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemContentType
import androidx.paging.compose.itemKey
import com.jayteealao.trails.R
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
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel> = rememberViewStore { viewModel() },
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Collect paging flows separately (not part of consolidated state)
    val articles = viewStore.action { articles }.collectAsLazyPagingItems()
    val favoriteArticles = viewStore.action { favoriteArticles }.collectAsLazyPagingItems()
    val archivedArticles = viewStore.action { archivedArticles }.collectAsLazyPagingItems()
    val taggedArticles = viewStore.action { taggedArticles }.collectAsLazyPagingItems()

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

    val onToggleFavorite: (ArticleItem, Boolean) -> Unit = { articleItem, isFavorite ->
        viewStore.action { setFavorite(articleItem.itemId, isFavorite) }
    }
    val onToggleRead: (ArticleItem, Boolean) -> Unit = { articleItem, isRead ->
        viewStore.action { setReadStatus(articleItem.itemId, isRead) }
    }
    val onToggleTag: (ArticleItem, String, Boolean) -> Unit = { articleItem, tag, enabled ->
        viewStore.action { updateTag(articleItem.itemId, tag, enabled) }
    }
    val onArchive: (ArticleItem) -> Unit = { articleItem ->
        viewStore.action { archiveArticle(articleItem.itemId) }
    }
    val onDelete: (ArticleItem) -> Unit = { articleItem ->
        viewStore.action { deleteArticle(articleItem.itemId) }
    }
    val onSortOptionSelected: (ArticleSortOption) -> Unit = { option ->
        viewStore.action { setSortOption(option) }
    }
    val onRequestTagSuggestions: (ArticleItem) -> Unit = { article ->
        viewStore.action { requestTagSuggestions(article) }
    }
    val onClearSuggestionError: (String) -> Unit = { articleId ->
        viewStore.action { clearTagSuggestionError(articleId) }
    }
    val onTagsClick: (ArticleItem) -> Unit = { _ ->
        // Tags sheet is opened directly in ArticleListItem when swipe button is clicked
        // No additional action needed here
    }
    val onRegenerateDetails: (ArticleItem) -> Unit = { articleItem ->
        viewStore.action { regenerateArticleDetails(articleItem.itemId) }
    }
    val onCopyLink: (ArticleItem) -> Unit = { articleItem ->
        viewStore.action { copyLink(articleItem.url ?: "", "Article URL") }
    }
    val onShare: (ArticleItem) -> Unit = { articleItem ->
        viewStore.action { shareArticle(articleItem.title, articleItem.url ?: "") }
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
                ArticleListTab.HOME -> PocketScreenContent(
                    lazyItems = articles,
                    sortOption = viewStore.state.sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    onTagsClick = onTagsClick,
                    onRegenerateDetails = onRegenerateDetails,
                    onCopyLink = onCopyLink,
                    onShare = onShare,
                    useCardLayout = useCardLayout,
                    availableTags = viewStore.state.tags,
                    tagSuggestions = viewStore.state.tagSuggestions,
                    onRequestTagSuggestions = onRequestTagSuggestions,
                    onClearSuggestionError = onClearSuggestionError
                )

                ArticleListTab.FAVOURITES -> PocketScreenContent(
                    lazyItems = favoriteArticles,
                    sortOption = viewStore.state.sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    onTagsClick = onTagsClick,
                    onRegenerateDetails = onRegenerateDetails,
                    onCopyLink = onCopyLink,
                    onShare = onShare,
                    useCardLayout = useCardLayout,
                    availableTags = viewStore.state.tags,
                    tagSuggestions = viewStore.state.tagSuggestions,
                    onRequestTagSuggestions = onRequestTagSuggestions,
                    onClearSuggestionError = onClearSuggestionError
                )

                ArticleListTab.ARCHIVE -> PocketScreenContent(
                    lazyItems = archivedArticles,
                    sortOption = viewStore.state.sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    onTagsClick = onTagsClick,
                    onRegenerateDetails = onRegenerateDetails,
                    onCopyLink = onCopyLink,
                    onShare = onShare,
                    useCardLayout = useCardLayout,
                    availableTags = viewStore.state.tags,
                    tagSuggestions = viewStore.state.tagSuggestions,
                    onRequestTagSuggestions = onRequestTagSuggestions,
                    onClearSuggestionError = onClearSuggestionError
                )

                ArticleListTab.TAGS -> TagsContent(
                    tags = viewStore.state.tags,
                    selectedTag = viewStore.state.selectedTag,
                    onSelectTag = { tag -> viewStore.action { selectTag(tag) } },
                    onClearSelection = { viewStore.action { selectTag(null) } },
                    lazyItems = taggedArticles,
                    sortOption = viewStore.state.sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    onTagsClick = onTagsClick,
                    onRegenerateDetails = onRegenerateDetails,
                    onCopyLink = onCopyLink,
                    onShare = onShare,
                    useCardLayout = useCardLayout,
                    availableTags = viewStore.state.tags,
                    tagSuggestions = viewStore.state.tagSuggestions,
                    onRequestTagSuggestions = onRequestTagSuggestions,
                    onClearSuggestionError = onClearSuggestionError
                )
            }
            ArticleDialog(
                article = viewStore.state.selectedArticle.copy(snippet = viewStore.state.selectedArticleSummary.summary),
                showDialog = viewStore.state.selectedArticle != EMPTYARTICLEITEM,
                onDismissRequest = { viewStore.action { selectArticle(EMPTYARTICLEITEM) } }
            )

        }
        NavigationBar(
            modifier = Modifier
                .wrapContentHeight(Alignment.Bottom),
            windowInsets = WindowInsets(0.dp, 0.dp, 0.dp, 0.dp),
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
        PocketScreenContent(
            lazyItems = rememberPreviewArticles(),
            sortOption = ArticleSortOption.Newest,
            onSortSelected = {},
            onSelectArticle = {},
            onToggleFavorite = { _, _ -> },
            onToggleRead = { _, _ -> },
            onToggleTag = { _, _, _ -> },
            onArchive = {},
            onDelete = {},
            useCardLayout = true,
            availableTags = listOf("compose", "kotlin", "android")
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
        PocketScreenContent(
            lazyItems = rememberPreviewArticles(),
            sortOption = ArticleSortOption.Newest,
            onSortSelected = {},
            onSelectArticle = {},
            onToggleFavorite = { _, _ -> },
            onToggleRead = { _, _ -> },
            onToggleTag = { _, _, _ -> },
            onArchive = {},
            onDelete = {},
            useCardLayout = true,
            availableTags = listOf("compose", "kotlin", "android")
        )
    }
}


@Composable
private fun TagsContent(
    tags: List<String>,
    selectedTag: String?,
    onSelectTag: (String) -> Unit,
    onClearSelection: () -> Unit,
    lazyItems: LazyPagingItems<ArticleItem>,
    sortOption: ArticleSortOption,
    onSortSelected: (ArticleSortOption) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleRead: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit,
    onTagsClick: (ArticleItem) -> Unit = {},
    onRegenerateDetails: (ArticleItem) -> Unit = {},
    onCopyLink: (ArticleItem) -> Unit = {},
    onShare: (ArticleItem) -> Unit = {},
    useCardLayout: Boolean,
    availableTags: List<String>,
    tagSuggestions: Map<String, TagSuggestionUiState>,
    onRequestTagSuggestions: (ArticleItem) -> Unit,
    onClearSuggestionError: (String) -> Unit,
) {
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
                            .clickable { onSelectTag(tag) }
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
                TextButton(onClick = onClearSelection) {
                    Text(text = "All tags")
                }
            }
            Box(modifier = Modifier.weight(1f)) {
                PocketScreenContent(
                    lazyItems = lazyItems,
                    sortOption = sortOption,
                    onSortSelected = onSortSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    onTagsClick = onTagsClick,
                    onRegenerateDetails = onRegenerateDetails,
                    onCopyLink = onCopyLink,
                    onShare = onShare,
                    useCardLayout = useCardLayout,
                    availableTags = availableTags,
                    tagSuggestions = tagSuggestions,
                    onRequestTagSuggestions = onRequestTagSuggestions,
                    onClearSuggestionError = onClearSuggestionError
                )
            }
        }
    }
}


@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    sortOption: ArticleSortOption,
    onSortSelected: (ArticleSortOption) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleRead: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit,
    onTagsClick: (ArticleItem) -> Unit = {},
    onRegenerateDetails: (ArticleItem) -> Unit = {},
    onCopyLink: (ArticleItem) -> Unit = {},
    onShare: (ArticleItem) -> Unit = {},
    useCardLayout: Boolean,
    availableTags: List<String>,
    tagSuggestions: Map<String, TagSuggestionUiState> = emptyMap(),
    onRequestTagSuggestions: (ArticleItem) -> Unit = {},
    onClearSuggestionError: (String) -> Unit = {},
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
                    ArticleListItem(
                        article,
                        Modifier.animateItem().then(
                            if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier
                        ),
                        onClick = { onSelectArticle(article) },
                        onFavoriteToggle = { isFavorite ->
                            onToggleFavorite(article, isFavorite)
                        },
                        onReadToggle = { isRead ->
                            onToggleRead(article, isRead)
                        },
                        onTagToggle = { tag, enabled ->
                            onToggleTag(article, tag, enabled)
                        },
                        onArchive = { onArchive(article) },
                        onDelete = { onDelete(article) },
                        onTagsClick = { onTagsClick(article) },
                        onRegenerateDetails = { onRegenerateDetails(article) },
                        onCopyLink = { onCopyLink(article) },
                        onShare = { onShare(article) },
                        useCardLayout = useCardLayout,
                        availableTags = availableTags,
                        tagSuggestionState = tagSuggestions[article.itemId] ?: TagSuggestionUiState(),
                        onRequestTagSuggestions = { onRequestTagSuggestions(article) },
                        onClearSuggestionError = { onClearSuggestionError(article.itemId) }
                    )
                }
            }
        }


    }
}


