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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.SnackbarHost
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.jayteealao.trails.R
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.articleList.components.AdaptiveArticleGrid
import com.jayteealao.trails.screens.articleList.components.ArticleListSkeleton
import com.jayteealao.trails.screens.components.Notice
import com.jayteealao.trails.screens.components.NoticeAction
import com.jayteealao.trails.screens.components.NoticeIcons
import com.jayteealao.trails.screens.components.showError
import com.jayteealao.trails.screens.preview.rememberPreviewArticles
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.testtags.ArticleListTestTags
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
    onSignIn: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
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
            snackbarHostState.showError(event.message, event.retry)
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

    LaunchedEffect(Unit) {
        viewStore.action { showLibrary() }
    }

    LaunchedEffect(viewStore.state.selectedTab) {
        if (viewStore.state.selectedTab != ArticleListTab.TAGS) {
            viewStore.action { selectTag(null) }
        }
    }

    val content: @Composable (LazyPagingItems<ArticleItem>) -> Unit = { lazyItems ->
        ArticleListScreenContent(
            lazyItems = lazyItems,
            viewStore = viewStore,
            onSelectArticle = onSelectArticle,
            onOpenTagManagement = onOpenTagManagement,
            useCardLayout = useCardLayout,
            onSignIn = onSignIn,
            onOpenSettings = onOpenSettings,
        )
    }

    ArticleListFrame(
        selectedTab = viewStore.state.selectedTab,
        onSelectTab = { viewStore.action { setSelectedTab(it) } },
        syncing = viewStore.state.databaseSync,
        snackbarHostState = snackbarHostState,
        modifier = modifier,
    ) {
        when (viewStore.state.selectedTab) {
            ArticleListTab.HOME -> content(articles)
            ArticleListTab.FAVOURITES -> content(favoriteArticles)
            ArticleListTab.ARCHIVE -> content(archivedArticles)
            ArticleListTab.TAGS -> TagsContent(
                state = viewStore.state,
                onSelectTag = { viewStore.action { selectTag(it) } },
                onRetryTags = { viewStore.action { retryTags() } },
            ) {
                content(taggedArticles)
            }
        }
    }
}

/**
 * The parts around every list: the sync progress bar above it, the tabs below it, and the messages
 * of the screen, which lie over the list and above the tabs.
 */
@Composable
internal fun ArticleListFrame(
    selectedTab: ArticleListTab,
    onSelectTab: (ArticleListTab) -> Unit,
    syncing: Boolean,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize()
    ) {
        AnimatedVisibility(
            visible = syncing,
            modifier = Modifier.padding(0.dp)
            ) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(0.dp)
                    .testTag(ArticleListTestTags.SYNC_INDICATOR),
                strokeCap = StrokeCap.Square,
            )
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            content()
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier.align(Alignment.BottomCenter),
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
                    selected = selectedTab == tab,
                    onClick = { onSelectTab(tab) },
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


/** The list of tags, or [articles] of the selected tag under its name. */
@Composable
internal fun TagsContent(
    state: ArticleListState,
    onSelectTag: (String?) -> Unit,
    onRetryTags: () -> Unit,
    articles: @Composable () -> Unit,
) {
    val selectedTag = state.selectedTag

    if (selectedTag == null) {
        val body = tagsBodyFor(state.tags.size, state.tagsLoad)
        if (body != ArticleListBody.Rows) {
            ArticleListBodyView(body, onAction = { onRetryTags() })
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surface)
            ) {
                items(state.tags) { tag ->
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
                TextButton(onClick = { onSelectTag(null) }) {
                    Text(text = "All tags")
                }
            }
            Box(modifier = Modifier.weight(1f)) {
                articles()
            }
        }
    }
}


/** The list of the selected tab: its rows, the skeleton while it loads, or the notice that says why not. */
@Composable
internal fun ArticleListScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    onOpenTagManagement: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
    onSignIn: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val state = viewStore.state
    val body = listBodyFor(
        tab = state.selectedTab,
        selectedTag = state.selectedTag,
        itemCount = lazyItems.itemCount,
        refresh = lazyItems.loadState.refresh,
        library = state.library,
    )
    if (body == ArticleListBody.Rows) {
        AdaptiveArticleGrid(
            lazyItems = lazyItems,
            viewStore = viewStore,
            onSelectArticle = onSelectArticle,
            onOpenTagManagement = onOpenTagManagement,
            useCardLayout = useCardLayout
        )
    } else {
        ArticleListBodyView(
            body = body,
            onAction = { action ->
                when (action) {
                    ListAction.RETRY_LIST -> lazyItems.retry()
                    ListAction.RETRY_LIBRARY -> viewStore.action { retryLibrary() }
                    ListAction.RETRY_TAGS -> viewStore.action { retryTags() }
                    ListAction.SIGN_IN -> onSignIn()
                    ListAction.OPEN_SETTINGS -> onOpenSettings()
                }
            },
        )
    }
}

/** The skeleton or the notice of [body], in the place of the list. */
@Composable
private fun ArticleListBodyView(body: ArticleListBody, onAction: (ListAction) -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .testTag(ArticleListTestTags.LIST_ROOT)
    ) {
        when (body) {
            ArticleListBody.Rows -> Unit
            ArticleListBody.Loading -> ArticleListSkeleton()
            is ArticleListBody.Message -> Notice(
                icon = body.icon.vector(),
                title = body.title,
                text = body.text,
                modifier = Modifier.fillMaxSize(),
                isError = body.isError,
                actions = body.actions.map { action ->
                    NoticeAction(action.label, action.style) { onAction(action) }
                },
            )
        }
    }
}

@Composable
private fun ListNoticeIcon.vector(): ImageVector = when (this) {
    ListNoticeIcon.BOOK -> NoticeIcons.Book
    ListNoticeIcon.FAVOURITE -> ImageVector.vectorResource(R.drawable.star_24px)
    ListNoticeIcon.ARCHIVE -> ImageVector.vectorResource(R.drawable.archive_icon_24)
    ListNoticeIcon.TAG -> ImageVector.vectorResource(R.drawable.tag_24px)
    ListNoticeIcon.OFFLINE -> ReaderNoticeIcons.Offline
    ListNoticeIcon.FAILED -> ReaderNoticeIcons.Failed
}
