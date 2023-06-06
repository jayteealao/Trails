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

package com.jayteealao.trails.ui.pocket

import androidx.compose.animation.animateColor
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.isContainer
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.items
import androidx.paging.compose.collectAsLazyPagingItems
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.local.database.PocketArticle
import com.jayteealao.trails.data.local.database.PocketTuple
import com.jayteealao.trails.ui.pocket.components.PocketItem
import java.net.URL

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PocketScreen(
    modifier: Modifier = Modifier,
    viewModel: PocketViewModel = hiltViewModel(),
    onSelectArticle: (PocketTuple) -> Unit,
    searchBarState: SearchBarState
) {

    val articles = viewModel.articles.collectAsLazyPagingItems()
    val isSyncing = viewModel.databaseSync.collectAsStateWithLifecycle()
    val searchResults = viewModel.searchResults.collectAsStateWithLifecycle()
    val searchBarContainerColor = searchBarState.searchBarContainerColor()

    Column(
        modifier = modifier
    ) {
//        Row {
//            Text(text = "syncing: ${isSyncing.value}")
//        }
        Box(
            modifier = Modifier
                .semantics { isContainer = true }
                .zIndex(1f)
                .fillMaxWidth()
        ) {
            SearchBar(
                modifier = Modifier
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
                    items(searchResults.value) { article ->
                        PocketItem(
                            article = article,
                        ) { onSelectArticle(article) }
                    }
                }
            }
        }
        PocketScreenContent(
            lazyItems = articles,
            onSelectArticle = onSelectArticle,
        )
    }
}

@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<PocketTuple>,
    onSelectArticle: (PocketTuple) -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize(),
//        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(lazyItems, key = { it.itemId }) { article ->
            if (article != null) {
                PocketItem(
                    article,
                    Modifier,
                ) { onSelectArticle(article) }
            }
        }
    }
}

