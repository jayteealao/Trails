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

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged


private enum class ArticleListTab(val label: String, val icon: @Composable () -> Unit = {}) {
    HOME(label = "Home", icon = { Icon(painter = painterResource(id = R.drawable.home_24px), contentDescription = "Home")}),
    FAVOURITES(label = "Favourites", icon = { Icon(painter = painterResource(id = R.drawable.favorite_24px), contentDescription = "Favourites")}),
    ARCHIVE(label = "Archive", icon = { Icon(painter = painterResource(id = R.drawable.archive_icon_24), contentDescription = "Archive")}),
    TAGS(label = "Tags", icon = { Icon(painter = painterResource(id = R.drawable.tag_24px), contentDescription = "Tags")}),
}

enum class ArticleSortOption(val label: String) {
    Newest("Newest"),
    Popular("Popular"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(
    modifier: Modifier = Modifier,
    viewModel: ArticleListViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
) {

    var selectedTab by rememberSaveable { mutableStateOf(ArticleListTab.HOME) }

    val articles = viewModel.articles.collectAsLazyPagingItems()
    val favoriteArticles = viewModel.favoriteArticles.collectAsLazyPagingItems()
    val archivedArticles = viewModel.archivedArticles.collectAsLazyPagingItems()
    val taggedArticles = viewModel.taggedArticles.collectAsLazyPagingItems()
    val isSyncing = viewModel.databaseSync.collectAsStateWithLifecycle()
    val article by remember { mutableStateOf<ArticleItem>(EMPTYARTICLEITEM) }
    val summary by viewModel.selectedArticleSummary.collectAsStateWithLifecycle()
    val selectedArticle by viewModel.selectedArticle.collectAsStateWithLifecycle()
    val tags by viewModel.tags.collectAsStateWithLifecycle()
    val selectedTag by viewModel.selectedTag.collectAsStateWithLifecycle()
    val sortOption by viewModel.sortOption.collectAsStateWithLifecycle()

    LaunchedEffect(selectedTab) {
        if (selectedTab != ArticleListTab.TAGS) {
            viewModel.selectTag(null)
        }
    }

    val onToggleFavorite: (ArticleItem, Boolean) -> Unit = { articleItem, isFavorite ->
        viewModel.setFavorite(articleItem.itemId, isFavorite)
    }
    val onToggleTag: (ArticleItem, String, Boolean) -> Unit = { articleItem, tag, enabled ->
        viewModel.updateTag(articleItem.itemId, tag, enabled)
    }
    val onToggleRead: (ArticleItem, Boolean) -> Unit = { articleItem, isRead ->
        viewModel.setReadStatus(articleItem.itemId, isRead)
    }
    val onArchive: (ArticleItem) -> Unit = { articleItem ->
        viewModel.archiveArticle(articleItem.itemId)
    }
    val onDelete: (ArticleItem) -> Unit = { articleItem ->
        viewModel.deleteArticle(articleItem.itemId)
    }
    val onSortOptionSelected: (ArticleSortOption) -> Unit = { option ->
        viewModel.setSortOption(option)
    }

    Column(
        modifier = modifier.fillMaxSize()
    ) {
        AnimatedVisibility(
            visible = isSyncing.value,
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
            when (selectedTab) {
                ArticleListTab.HOME -> PocketScreenContent(
                    lazyItems = articles,
                    sortOption = sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    useCardLayout = useCardLayout,
                    availableTags = tags
                )

                ArticleListTab.FAVOURITES -> PocketScreenContent(
                    lazyItems = favoriteArticles,
                    sortOption = sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    useCardLayout = useCardLayout,
                    availableTags = tags
                )

                ArticleListTab.ARCHIVE -> PocketScreenContent(
                    lazyItems = archivedArticles,
                    sortOption = sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    useCardLayout = useCardLayout,
                    availableTags = tags
                )

                ArticleListTab.TAGS -> TagsContent(
                    tags = tags,
                    selectedTag = selectedTag,
                    onSelectTag = { tag -> viewModel.selectTag(tag) },
                    onClearSelection = { viewModel.selectTag(null) },
                    lazyItems = taggedArticles,
                    sortOption = sortOption,
                    onSortSelected = onSortOptionSelected,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleRead = onToggleRead,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete,
                    useCardLayout = useCardLayout,
                    availableTags = tags
                )
            }
            ArticleDialog(
                article = article.copy(snippet = summary.summary),
                showDialog = selectedArticle != EMPTYARTICLEITEM,
                onDismissRequest = { viewModel.selectArticle(EMPTYARTICLEITEM) }
            )

        }
        NavigationBar(
            modifier = Modifier
                .wrapContentHeight(Alignment.Bottom),
            windowInsets = WindowInsets(0.dp, 0.dp, 0.dp, 0.dp),
            containerColor = MaterialTheme.colorScheme.surface,
//                .height(64.dp)
        ) {
            ArticleListTab.values().forEach { tab ->
                NavigationBarItem(
                    selected = selectedTab == tab,
                    onClick = { selectedTab = tab },
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
    useCardLayout: Boolean,
    availableTags: List<String>,
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
                    useCardLayout = useCardLayout,
                    availableTags = availableTags
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
    useCardLayout: Boolean,
    availableTags: List<String>,
) {
    val listState = rememberLazyListState()
    var actionBarVisible by remember { mutableStateOf(true) }

    LaunchedEffect(listState) {
        var previousIndex = listState.firstVisibleItemIndex
        var previousScrollOffset = listState.firstVisibleItemScrollOffset
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .distinctUntilChanged()
            .collectLatest { (index, offset) ->
                val scrollingForward = when {
                    index == previousIndex -> offset > previousScrollOffset
                    else -> index > previousIndex
                }
                actionBarVisible = if (!listState.isScrollInProgress) {
                    true
                } else {
                    !scrollingForward
                }
                previousIndex = index
                previousScrollOffset = offset
            }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        val actionBarHeight = 56.dp
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize(),
            contentPadding = PaddingValues(
                top = actionBarHeight + 16.dp,
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
                        useCardLayout = useCardLayout,
                        availableTags = availableTags
                    )
                }
            }
        }

        AnimatedVisibility(
            visible = actionBarVisible,
            enter = slideInVertically(initialOffsetY = { -it / 2 }) + fadeIn(),
            exit = slideOutVertically(targetOffsetY = { -it / 2 }) + fadeOut(),
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            ArticleActionsBar(
                modifier = Modifier.fillMaxWidth(),
                sortOption = sortOption,
                onSortSelected = onSortSelected
            )
        }
    }
}

@Composable
private fun ArticleActionsBar(
    modifier: Modifier = Modifier,
    sortOption: ArticleSortOption,
    onSortSelected: (ArticleSortOption) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Surface(
        modifier = modifier,
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Actions",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Box {
                OutlinedButton(onClick = { expanded = true }) {
                    Icon(imageVector = Icons.Filled.Sort, contentDescription = "Sort")
                    Text(
                        text = sortOption.label,
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
                DropdownMenu(
                    expanded = expanded,
                    onDismissRequest = { expanded = false }
                ) {
                    ArticleSortOption.values().forEach { option ->
                        DropdownMenuItem(
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (option == sortOption) {
                                        Icon(
                                            imageVector = Icons.Filled.Check,
                                            contentDescription = null,
                                            modifier = Modifier.padding(end = 8.dp)
                                        )
                                    }
                                    Text(text = option.label)
                                }
                            },
                            onClick = {
                                expanded = false
                                onSortSelected(option)
                            }
                        )
                    }
                }
            }
        }
    }
}

