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
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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


private enum class ArticleListTab(val label: String, val icon: @Composable () -> Unit = {}) {
    HOME(label = "Home", icon = { Icon(painter = painterResource(id = R.drawable.home_24px), contentDescription = "Home")}),
    FAVOURITES(label = "Favourites", icon = { Icon(painter = painterResource(id = R.drawable.favorite_24px), contentDescription = "Favourites")}),
    ARCHIVE(label = "Archive", icon = { Icon(painter = painterResource(id = R.drawable.archive_icon_24), contentDescription = "Archive")}),
    TAGS(label = "Tags", icon = { Icon(painter = painterResource(id = R.drawable.tag_24px), contentDescription = "Tags")}),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(
    modifier: Modifier = Modifier,
    viewModel: ArticleListViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit,
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
    val onArchive: (ArticleItem) -> Unit = { articleItem ->
        viewModel.archiveArticle(articleItem.itemId)
    }
    val onDelete: (ArticleItem) -> Unit = { articleItem ->
        viewModel.deleteArticle(articleItem.itemId)
    }

    Column(
        modifier = modifier.fillMaxSize()
    ) {
        AnimatedVisibility(visible = isSyncing.value) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth(),
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
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete
                )

                ArticleListTab.FAVOURITES -> PocketScreenContent(
                    lazyItems = favoriteArticles,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete
                )

                ArticleListTab.ARCHIVE -> PocketScreenContent(
                    lazyItems = archivedArticles,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete
                )

                ArticleListTab.TAGS -> TagsContent(
                    tags = tags,
                    selectedTag = selectedTag,
                    onSelectTag = { tag -> viewModel.selectTag(tag) },
                    onClearSelection = { viewModel.selectTag(null) },
                    lazyItems = taggedArticles,
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete
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
                .wrapContentHeight(Alignment.Bottom)
                .height(64.dp)
                .wrapContentHeight(Alignment.Bottom),
            windowInsets = WindowInsets(0.dp, 0.dp, 0.dp, 0.dp),
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
            onSelectArticle = {},
            onToggleFavorite = { _, _ -> },
            onToggleTag = { _, _, _ -> },
            onArchive = {},
            onDelete = {}
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
            onSelectArticle = {},
            onToggleFavorite = { _, _ -> },
            onToggleTag = { _, _, _ -> },
            onArchive = {},
            onDelete = {}
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
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit,
) {
    if (selectedTag == null) {
        if (tags.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White),
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
                    .background(Color.White)
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
                .background(Color.White)
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
                    onSelectArticle = onSelectArticle,
                    onToggleFavorite = onToggleFavorite,
                    onToggleTag = onToggleTag,
                    onArchive = onArchive,
                    onDelete = onDelete
                )
            }
        }
    }
}


@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    onSelectArticle: (ArticleItem) -> Unit,
    onToggleFavorite: (ArticleItem, Boolean) -> Unit,
    onToggleTag: (ArticleItem, String, Boolean) -> Unit,
    onArchive: (ArticleItem) -> Unit,
    onDelete: (ArticleItem) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F5))
            .padding(horizontal = 16.dp, vertical = 16.dp)
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
                        if (index != 0) Modifier.padding(top = 12.dp) else Modifier.padding(top = 0.dp)
                    ),
                    onClick = { onSelectArticle(article) },
                    onFavoriteToggle = { isFavorite ->
                        onToggleFavorite(article, isFavorite)
                    },
                    onTagToggle = { tag, enabled ->
                        onToggleTag(article, tag, enabled)
                    },
                    onArchive = { onArchive(article) },
                    onDelete = { onDelete(article) }
                )
            }
        }
    }
}

