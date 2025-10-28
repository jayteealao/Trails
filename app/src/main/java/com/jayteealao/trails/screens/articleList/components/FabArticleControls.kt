package com.jayteealao.trails.screens.articleList.components

import android.R.attr.contentDescription
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun FabArticleControls(
    modifier: Modifier = Modifier,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    selectedCount: Int,
    onSortToggle: () -> Unit,
    onReadFilterCycle: () -> Unit,
    onBulkSelectToggle: () -> Unit,
    onSearchClick: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val rotation by animateFloatAsState(
        targetValue = if (expanded) 45f else 0f,
        label = "fab rotation"
    )

    val activeFilterCount = listOf(
        sortOption != ArticleSortOption.Newest,
        readFilter != ReadFilter.ALL
    ).count { it }

    Box(modifier = modifier) {
        // Scrim when expanded
        if (expanded) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
            )
        }

        Column(
            horizontalAlignment = Alignment.End,
            modifier = Modifier.padding(16.dp)
        ) {
            // Mini FABs
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(
                    horizontalAlignment = Alignment.End,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    // Sort FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(
                                    if (sortOption == ArticleSortOption.Newest)
                                        R.drawable.arrow_downward_24px
                                    else
                                        R.drawable.arrow_upward_24px
                                ),
                                contentDescription = "Sort ${sortOption.label}"
                            )
                        },
                        label = sortOption.label,
                        onClick = {
                            onSortToggle()
                            expanded = false
                        }
                    )

                    // Filter FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(R.drawable.filter_list_24px),
                                contentDescription = "Filter ${readFilter.name}"
                            )
                        },
                        label = when (readFilter) {
                            ReadFilter.ALL -> "All"
                            ReadFilter.READ_ONLY -> "Read"
                            ReadFilter.UNREAD_ONLY -> "Unread"
                        },
                        onClick = {
                            onReadFilterCycle()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )

                    // Bulk select FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(R.drawable.check_24px),
                                contentDescription = "Bulk select"
                            )
                        },
                        label = if (bulkSelectionMode) "Exit ($selectedCount)" else "Select",
                        onClick = {
                            onBulkSelectToggle()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )

                    // Search FAB
                    MiniFabWithLabel(
                        icon = {
                            Icon(
                                painter = painterResource(R.drawable.search_24px),
                                contentDescription = "Search"
                            )
                        },
                        label = "Search",
                        onClick = {
                            onSearchClick()
                            expanded = false
                        },
                        modifier = Modifier.padding(top = 12.dp)
                    )
                }
            }

            // Main FAB
            BadgedBox(
                badge = {
                    if (activeFilterCount > 0 && !expanded) {
                        Badge { Text(text = activeFilterCount.toString()) }
                    }
                    if (bulkSelectionMode && selectedCount > 0 && !expanded) {
                        Badge { Text(text = selectedCount.toString()) }
                    }
                }
            ) {
                FloatingActionButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.rotate(rotation)
                ) {
                    Icon(
                        painter = if (expanded) painterResource(R.drawable.close_24px) else painterResource(
                            R.drawable.filter_list_24px),
                        contentDescription = if (expanded) "Close controls" else "Open controls"
                    )
                }
            }
        }
    }
}

@Composable
private fun MiniFabWithLabel(
    icon: @Composable () -> Unit,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.CenterEnd
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(end = 56.dp)
        )
        SmallFloatingActionButton(
            onClick = onClick,
            modifier = Modifier.size(40.dp)
        ) {
            icon()
        }
    }
}
