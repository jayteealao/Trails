package com.jayteealao.trails.screens.articleList.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.ui.res.painterResource
import com.jayteealao.trails.R
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun PullDownArticleControls(
    modifier: Modifier = Modifier,
    visible: Boolean,
    searchQuery: String,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    onSearchQueryChange: (String) -> Unit,
    onSortToggle: () -> Unit,
    onReadFilterCycle: () -> Unit,
    onBulkSelectToggle: () -> Unit,
    onDismiss: () -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier
    ) {
        Surface(
            tonalElevation = 3.dp,
            shadowElevation = 2.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                // Search bar with close button
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    TextField(
                        value = searchQuery,
                        onValueChange = onSearchQueryChange,
                        placeholder = { Text("Search articles...") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )

                    IconButton(onClick = onDismiss) {
                        Icon(
                            painter = painterResource(com.jayteealao.trails.R.drawable.close_24px),
                            contentDescription = "Close controls"
                        )
                    }
                }

                // Control chips row
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                ) {
                    // Sort chip
                    FilterChip(
                        selected = sortOption != ArticleSortOption.Newest,
                        onClick = onSortToggle,
                        label = {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(sortOption.label)
                                Icon(
                                    painter = painterResource(
                                        if (sortOption == ArticleSortOption.Newest)
                                            com.jayteealao.trails.R.drawable.arrow_downward_24px
                                        else
                                            com.jayteealao.trails.R.drawable.arrow_upward_24px
                                    ),
                                    contentDescription = null
                                )
                            }
                        }
                    )

                    // Filter chip
                    FilterChip(
                        selected = readFilter != ReadFilter.ALL,
                        onClick = onReadFilterCycle,
                        label = {
                            Text(when (readFilter) {
                                ReadFilter.ALL -> "All"
                                ReadFilter.READ_ONLY -> "Read"
                                ReadFilter.UNREAD_ONLY -> "Unread"
                            })
                        }
                    )

                    // Bulk select button
                    OutlinedButton(
                        onClick = onBulkSelectToggle
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.check_24px),
                            contentDescription = null
                        )
                        Text(
                            text = if (bulkSelectionMode) "Exit" else "Select",
                            modifier = Modifier.padding(start = 4.dp)
                        )
                    }
                }
            }
        }
    }
}
