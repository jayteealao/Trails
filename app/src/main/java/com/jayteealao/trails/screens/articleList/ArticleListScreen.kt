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

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemContentType
import androidx.paging.compose.itemKey
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.screens.articleList.components.ArticleDialog
import com.jayteealao.trails.screens.articleList.components.ArticleListItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(
    modifier: Modifier = Modifier,
    viewModel: ArticleListViewModel = hiltViewModel(),
    onSelectArticle: (ArticleItem) -> Unit,
) {

    val articles = viewModel.articles.collectAsLazyPagingItems()
    val isSyncing = viewModel.databaseSync.collectAsStateWithLifecycle()
    val article by remember { mutableStateOf<ArticleItem>(EMPTYARTICLEITEM) }
    val summary by viewModel.selectedArticleSummary.collectAsStateWithLifecycle()
    val selectedArticle by viewModel.selectedArticle.collectAsStateWithLifecycle()

    Column(
        modifier = modifier
    ) {
            AnimatedVisibility(visible = isSyncing.value) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth(),
                    strokeCap = StrokeCap.Square,
                )
            }
        Box(modifier = Modifier.fillMaxSize() ) {
            PocketScreenContent(
                lazyItems = articles,
                onSelectArticle = {
                    onSelectArticle(it)

                }
            )
            ArticleDialog(
                article = article.copy(snippet = summary.summary),
                showDialog = selectedArticle != EMPTYARTICLEITEM,
                onDismissRequest = { viewModel.selectArticle(EMPTYARTICLEITEM) }
            )

        }
    }

}


@Composable
internal fun PocketScreenContent(
    lazyItems: LazyPagingItems<ArticleItem>,
    onSelectArticle: (ArticleItem) -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .padding(vertical = 16.dp)
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
                    Modifier.animateItem(),
                ) { onSelectArticle(article) }
            }
        }
    }
}

