package com.jayteealao.trails.screens.articleSearch

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.R
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.components.ArticleListItem
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.preview.previewSearchBarState
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleSearchScreen(
    searchBarState: SearchBarState,
    viewStore: ViewStore<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel> = rememberViewStore { hiltViewModel() },
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
) {
    // Handle events
    viewStore.handle<ArticleSearchEvent.NavigateToArticle> { event ->
        // Navigation handled by parent
    }

    viewStore.handle<ArticleSearchEvent.ShowError> { event ->
        // Show error toast/snackbar
    }

    viewStore.handle<ArticleSearchEvent.ShowToast> { event ->
        // Show toast message
    }

    ArticleSearchContent(
        modifier = Modifier.fillMaxSize(),
        searchBarState = searchBarState,
        viewStore = viewStore,
        onQueryChange = { searchBarState.updateSearchText(it) },
        onSearch = { viewStore.action { search(searchBarState.searchText) } },
        onActiveChange = { searchBarState.searchBarActive = it },
        onSelectArticle = onSelectArticle,
        useCardLayout = useCardLayout
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ArticleSearchContent(
    modifier: Modifier = Modifier,
    searchBarState: SearchBarState,
    viewStore: ViewStore<ArticleSearchState, ArticleSearchEvent, ArticleSearchViewModel>,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onActiveChange: (Boolean) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
) {
    val searchBarContainerColor = searchBarState.searchBarContainerColor()
    val searchResults = viewStore.state.combinedResults

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.Top
    ) {
        SearchBar(
            modifier = Modifier
                .padding(top = 0.dp)
                .fillMaxWidth(),
            query = searchBarState.searchText,
            onQueryChange = onQueryChange,
            onSearch = { onSearch() },
            active = searchBarState.searchBarActive,
            onActiveChange = onActiveChange,
            placeholder = { Text(text = "Search") },
            leadingIcon = { Icon(painterResource(R.drawable.search_24px), contentDescription = null) },
            trailingIcon = { Icon(painterResource(R.drawable.more_vert_24px), contentDescription = null) },
            shape = RectangleShape,
            tonalElevation = 0.dp,
            colors = SearchBarDefaults.colors(
                containerColor = searchBarContainerColor.value,
                dividerColor = MaterialTheme.colorScheme.primary,
            )
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xFFF5F5F5))
                    .padding(horizontal = 16.dp, vertical = 16.dp)
            ) {
                itemsIndexed(
                    items = searchResults,
                    key = { _, article -> article.itemId }
                ) { index, article ->
                    SearchResultItem(
                        article = article,
                        modifier = if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier,
                        onClick = { onSelectArticle(article) }
                    )
                }
            }
        }
    }
}

@Preview(name = "Search • Suggestions", showBackground = true)
@Composable
private fun ArticleSearchPreview() {
    TrailsTheme {
        ArticleSearchScreen(
            searchBarState = previewSearchBarState(query = "trail"),
            viewStore = ViewStore {
                ArticleSearchState(
                    searchResultsLocal = PreviewFixtures.articleList,
                    searchResultsHybrid = emptyList(),
                    isSearching = false
                )
            },
            onSelectArticle = {},
            useCardLayout = true
        )
    }
}

@Preview(
    name = "Search • Empty (Dark)",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleSearchEmptyPreview() {
    TrailsTheme(darkTheme = true) {
        ArticleSearchScreen(
            searchBarState = previewSearchBarState(active = true, query = "winter"),
            viewStore = ViewStore {
                ArticleSearchState(
                    searchResultsLocal = emptyList(),
                    searchResultsHybrid = emptyList(),
                    isSearching = false
                )
            },
            onSelectArticle = {},
            useCardLayout = true
        )
    }
}

@Composable
private fun SearchResultItem(
    article: ArticleItem,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    androidx.compose.material3.Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        onClick = onClick
    ) {
        androidx.compose.foundation.layout.Column(
            modifier = Modifier.padding(12.dp)
        ) {
            androidx.compose.material3.Text(
                text = article.title,
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
            )
            article.url?.let { url ->
                androidx.compose.material3.Text(
                    text = url,
                    style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                )
            }
        }
    }
}
