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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jayteealao.trails.R
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.components.ArticleListItem
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.preview.previewSearchBarState
import com.jayteealao.trails.screens.theme.TrailsTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleSearchScreen(
    searchBarState: SearchBarState,
    viewModel: ArticleSearchViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
) {
    val searchResultsLocal = viewModel.searchResultsLocal.collectAsStateWithLifecycle()
    val searchResultsHybrid = viewModel.searchResultsHybrid.collectAsStateWithLifecycle()
    val searchResult = linkedSetOf(searchResultsHybrid.value, searchResultsLocal.value).flatten()

    ArticleSearchContent(
        modifier = Modifier.fillMaxSize(),
        searchBarState = searchBarState,
        searchResults = searchResult,
        onQueryChange = { searchBarState.updateSearchText(it) },
        onSearch = { viewModel.search(searchBarState.searchText) },
        onActiveChange = { searchBarState.searchBarActive = it },
        onSelectArticle = onSelectArticle,
        useCardLayout = useCardLayout,
        setFavorite = { itemId, isFavorite ->
            viewModel.setFavorite(itemId, isFavorite)
        },
        setReadStatus = { itemId, isRead ->
            viewModel.setReadStatus(itemId, isRead)
        },
        updateTag = { itemId, tag, enabled ->
            viewModel.updateTag(itemId, tag, enabled)
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ArticleSearchContent(
    modifier: Modifier = Modifier,
    searchBarState: SearchBarState,
    searchResults: List<ArticleItem>,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onActiveChange: (Boolean) -> Unit,
    onSelectArticle: (ArticleItem) -> Unit,
    useCardLayout: Boolean = false,
    setFavorite: (String, Boolean) -> Unit = { _, _ -> },
    setReadStatus: (String, Boolean) -> Unit = { _, _ -> },
    updateTag: (String, String, Boolean) -> Unit = { _, _, _ -> },
) {
    val searchBarContainerColor = searchBarState.searchBarContainerColor()

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
                    ArticleListItem(
                        article = article,
                        modifier = if (index != 0) Modifier.padding(top = if (useCardLayout) 12.dp else 8.dp) else Modifier,
                        onClick = { onSelectArticle(article) },
                        onFavoriteToggle = { isFavorite ->
                            setFavorite(article.itemId, isFavorite)
                        },
                        onReadToggle = { isRead ->
                            setReadStatus(article.itemId, isRead)
                        },
                        onTagToggle = { tag, enabled ->
                            updateTag(article.itemId, tag, enabled)
                        },
                        useCardLayout = useCardLayout
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
        ArticleSearchContent(
            modifier = Modifier.fillMaxSize(),
            searchBarState = previewSearchBarState(query = "trail"),
            searchResults = PreviewFixtures.articleList,
            onQueryChange = {},
            onSearch = {},
            onActiveChange = {},
            onSelectArticle = {},
            useCardLayout = true,
            setReadStatus = { _, _ -> },
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
        ArticleSearchContent(
            modifier = Modifier.fillMaxSize(),
            searchBarState = previewSearchBarState(active = true, query = "winter"),
            searchResults = emptyList(),
            onQueryChange = {},
            onSearch = {},
            onActiveChange = {},
            onSelectArticle = {},
            useCardLayout = true,
            setReadStatus = { _, _ -> },
        )
    }
}
