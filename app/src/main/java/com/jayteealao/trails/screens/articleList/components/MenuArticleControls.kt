package com.jayteealao.trails.screens.articleList.components

import androidx.compose.material3.Badge
import androidx.compose.ui.res.painterResource
import com.jayteealao.trails.R
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.jayteealao.trails.screens.articleList.ArticleListViewModel.ReadFilter
import com.jayteealao.trails.screens.articleList.ArticleSortOption

@Composable
fun MenuArticleControls(
    modifier: Modifier = Modifier,
    sortOption: ArticleSortOption,
    readFilter: ReadFilter,
    bulkSelectionMode: Boolean,
    onSortSelected: (ArticleSortOption) -> Unit,
    onReadFilterSelected: (ReadFilter) -> Unit,
    onBulkSelectToggle: () -> Unit,
    onSettingsClick: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var showSortSubmenu by remember { mutableStateOf(false) }
    var showFilterSubmenu by remember { mutableStateOf(false) }

    val activeFilterCount = listOf(
        sortOption != ArticleSortOption.Newest,
        readFilter != ReadFilter.ALL
    ).count { it }

    BadgedBox(
        badge = {
            if (activeFilterCount > 0) {
                Badge { Text(text = activeFilterCount.toString()) }
            }
        },
        modifier = modifier
    ) {
        IconButton(onClick = { expanded = true }) {
            Icon(
                painter = painterResource(R.drawable.more_vert_24px),
                contentDescription = "Article controls menu"
            )
        }
    }

    DropdownMenu(
        expanded = expanded,
        onDismissRequest = { expanded = false }
    ) {
        // Sort submenu
        DropdownMenuItem(
            text = { Text("Sort") },
            onClick = { showSortSubmenu = !showSortSubmenu },
            trailingIcon = {
                Text(text = sortOption.label)
            }
        )

        DropdownMenu(
            expanded = showSortSubmenu,
            onDismissRequest = { showSortSubmenu = false }
        ) {
            ArticleSortOption.values().forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    onClick = {
                        onSortSelected(option)
                        showSortSubmenu = false
                        expanded = false
                    },
                    leadingIcon = {
                        if (option == sortOption) {
                            Icon(painter = painterResource(R.drawable.check_24px), contentDescription = null)
                        }
                    }
                )
            }
        }

        // Filter submenu
        DropdownMenuItem(
            text = { Text("Filter") },
            onClick = { showFilterSubmenu = !showFilterSubmenu },
            trailingIcon = {
                Text(text = when (readFilter) {
                    ReadFilter.ALL -> "All"
                    ReadFilter.READ_ONLY -> "Read"
                    ReadFilter.UNREAD_ONLY -> "Unread"
                })
            }
        )

        DropdownMenu(
            expanded = showFilterSubmenu,
            onDismissRequest = { showFilterSubmenu = false }
        ) {
            listOf(
                ReadFilter.ALL to "All articles",
                ReadFilter.UNREAD_ONLY to "Unread only",
                ReadFilter.READ_ONLY to "Read only"
            ).forEach { (filter, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        onReadFilterSelected(filter)
                        showFilterSubmenu = false
                        expanded = false
                    },
                    leadingIcon = {
                        if (filter == readFilter) {
                            Icon(painter = painterResource(R.drawable.check_24px), contentDescription = null)
                        }
                    }
                )
            }
        }

        // Bulk select toggle
        DropdownMenuItem(
            text = { Text(if (bulkSelectionMode) "Exit bulk select" else "Bulk select") },
            onClick = {
                onBulkSelectToggle()
                expanded = false
            },
            leadingIcon = {
                if (bulkSelectionMode) {
                    Icon(painter = painterResource(R.drawable.check_24px), contentDescription = null)
                }
            }
        )

        // Settings
        DropdownMenuItem(
            text = { Text("Settings") },
            onClick = {
                onSettingsClick()
                expanded = false
            }
        )
    }
}
