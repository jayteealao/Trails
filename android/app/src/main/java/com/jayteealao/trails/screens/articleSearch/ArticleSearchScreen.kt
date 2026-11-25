package com.jayteealao.trails.screens.articleSearch

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.R
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.articleList.components.ArticleListItem
import com.jayteealao.trails.screens.articleList.components.ArticleListSkeleton
import com.jayteealao.trails.screens.components.Notice
import com.jayteealao.trails.screens.components.NoticeAction
import com.jayteealao.trails.screens.components.NoticeActionStyle
import com.jayteealao.trails.screens.components.TRY_AGAIN
import com.jayteealao.trails.screens.components.showError
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.preview.previewSearchBarState
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.launch

@Composable
fun ArticleSearchScreen(
    searchBarState: SearchBarState,
    viewStore: ViewStore<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel> = rememberViewStore { hiltViewModel() },
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val scope = rememberCoroutineScope()

    // Handle events
    viewStore.handle<ArticleSearchEvent.NavigateToArticle> { event ->
        // Navigation handled by parent
    }

    viewStore.handle<ArticleSearchEvent.ShowError> { event ->
        scope.launch { snackbarHostState.showError(event.message, event.retry) }
    }

    viewStore.handle<ArticleSearchEvent.ShowToast> { event ->
        scope.launch { snackbarHostState.showSnackbar(event.message) }
    }

    viewStore.handle<ArticleSearchEvent.ShareArticle> { event ->
        // Share article handled by parent
    }

    viewStore.handle<ArticleSearchEvent.CopyLink> { event ->
        // Copy link handled by parent
    }

    ArticleSearchContent(
        searchText = searchBarState.searchText,
        viewStore = viewStore,
        onTextChange = { searchBarState.updateSearchText(it) },
        onSearch = { query -> viewStore.action { search(query) } },
        onClear = {
            searchBarState.updateSearchText("")
            viewStore.action { clearSearch() }
        },
        onSelectArticle = onSelectArticle,
        snackbarHostState = snackbarHostState,
        useCardLayout = useCardLayout,
    )
}

/**
 * The search field, and under it what the newest search found: nothing before the first search,
 * the skeleton while it runs, its rows, or the notice that says why there are none. The notice
 * names the words that were searched, not the words being typed.
 */
@Composable
internal fun ArticleSearchContent(
    searchText: String,
    viewStore: ViewStore<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel>,
    onTextChange: (String) -> Unit,
    onSearch: (String) -> Unit,
    onClear: () -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
    useCardLayout: Boolean = false,
) {
    val state = viewStore.state
    val query = state.searchedQuery

    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        SearchField(
            text = searchText,
            onTextChange = onTextChange,
            onSearch = { onSearch(searchText) },
            onClear = onClear,
        )
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
        ) {
            when {
                state.isSearching -> ArticleListSkeleton(rows = 3)
                state.searchFailed -> Notice(
                    icon = ReaderNoticeIcons.Failed,
                    title = "Search did not finish",
                    text = "Your articles are still saved. Try again.",
                    modifier = Modifier.fillMaxSize(),
                    isError = true,
                    actions = listOf(
                        NoticeAction(TRY_AGAIN, NoticeActionStyle.FILLED) { onSearch(query.orEmpty()) },
                    ),
                )
                state.searchResults.isNotEmpty() ->
                    SearchResults(viewStore, onSelectArticle, useCardLayout)
                !query.isNullOrBlank() -> Notice(
                    icon = ImageVector.vectorResource(R.drawable.search_24px),
                    title = "No articles match “$query”",
                    text = "Search looks in titles and saved text. Check the spelling, or try fewer words.",
                    modifier = Modifier.fillMaxSize(),
                    actions = listOf(NoticeAction("Clear search", NoticeActionStyle.TEXT, onClear)),
                )
            }
            SnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun SearchResults(
    viewStore: ViewStore<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel>,
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = if (useCardLayout) 16.dp else 0.dp)
    ) {
        itemsIndexed(
            items = viewStore.state.searchResults,
            key = { _, article -> article.itemId }
        ) { index, article ->
            ArticleListItem<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel>(
                article = article,
                viewStore = viewStore,
                modifier = Modifier.animateItem().then(
                    if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier
                ),
                onClick = { onSelectArticle(article) },
                onOpenTagManagement = {},
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

@Preview(name = "Search • Results", showBackground = true)
@Composable
private fun ArticleSearchPreview() {
    TrailsTheme {
        ArticleSearchScreen(
            searchBarState = previewSearchBarState(query = "trail"),
            viewStore = ViewStore {
                ArticleSearchState(
                    searchResults = PreviewFixtures.articleList,
                    searchedQuery = "trail"
                )
            },
            onSelectArticle = {},
        )
    }
}

@Preview(
    name = "Search • No match (Dark)",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleSearchEmptyPreview() {
    TrailsTheme(darkTheme = true) {
        ArticleSearchScreen(
            searchBarState = previewSearchBarState(query = "winter"),
            viewStore = ViewStore { ArticleSearchState(searchedQuery = "winter") },
            onSelectArticle = {},
        )
    }
}
