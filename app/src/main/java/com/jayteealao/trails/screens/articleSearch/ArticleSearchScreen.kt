package com.jayteealao.trails.screens.articleSearch

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBar
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.components.ArticleListItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleSearchScreen(
    searchBarState: SearchBarState,
    viewModel: ArticleSearchViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit
) {
    val searchResultsLocal = viewModel.searchResultsLocal.collectAsStateWithLifecycle()
    val searchResultsHybrid = viewModel.searchResultsHybrid.collectAsStateWithLifecycle()
    val searchResult = linkedSetOf(searchResultsHybrid.value, searchResultsLocal.value).flatten()
    val searchBarContainerColor = searchBarState.searchBarContainerColor()

// TODO: ADD a disposable effect to clear the search state when the screen is removed from the backstack

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Top
    ){
        SearchBar(
            modifier = Modifier
                .padding(top = 0.dp)
                .fillMaxWidth(),
            query = searchBarState.searchText,
            onQueryChange = { searchBarState.updateSearchText(it) },
            onSearch = { viewModel.search(searchBarState.searchText) },
            active = searchBarState.searchBarActive,
            onActiveChange = { searchBarState.searchBarActive = it },
            placeholder = { Text(text = "Search") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = { Icon(Icons.Default.MoreVert, contentDescription = null) },
            shape = RectangleShape,
            tonalElevation = 0.dp,
            colors = SearchBarDefaults.colors(
                containerColor = searchBarContainerColor.value,
                dividerColor = MaterialTheme.colorScheme.primary,
            )
        ) {
            LazyColumn {
                items(
                    items = searchResult,
                    key = { article -> article.itemId }
                ) { article ->
                    ArticleListItem(
                        article = article,
                        onClick = { onSelectArticle(article) },
                        onFavoriteToggle = { isFavorite ->
                            viewModel.setFavorite(article.itemId, isFavorite)
                        },
                        onTagToggle = { tag, enabled ->
                            viewModel.updateTag(article.itemId, tag, enabled)
                        }
                    )
                }

//                items(
//                    items = searchResultsHybrid.value,
//                    key = { article -> article.itemId + "_HYBRID" }
//                ) { article ->
//                    ArticleListItem(
//                        article = article,
//                    ) { onSelectArticle(article) }
//                }
//
//                items(
//                    items = searchResultsLocal.value,
//                    key = { article -> article.itemId + "_LOCAL" }
//                ) { article ->
//                    ArticleListItem(
//                        article = article,
//                    ) { onSelectArticle(article) }
//                }
            }
        }
    }
}