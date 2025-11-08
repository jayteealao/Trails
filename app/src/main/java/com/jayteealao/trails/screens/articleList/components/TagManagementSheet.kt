package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.ArticleListEvent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import io.yumemi.tartlet.ViewStore

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TagManagementSheet(
    article: ArticleItem,
    viewStore: ViewStore<ArticleListState, ArticleListEvent, ArticleListViewModel>,
    showSheet: Boolean,
    onDismiss: () -> Unit,
    sheetState: SheetState,
    tagStates: MutableMap<String, Boolean>,
    newTagText: String,
    onNewTagTextChange: (String) -> Unit,
    onAddNewTag: () -> Unit,
    tagSuggestionState: com.jayteealao.trails.screens.articleList.TagSuggestionUiState = com.jayteealao.trails.screens.articleList.TagSuggestionUiState()
) {
    if (showSheet) {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Manage tags",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )

                // Input field at the top
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = newTagText,
                        onValueChange = onNewTagTextChange,
                        label = { Text(text = "New tag") },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedTextColor = MaterialTheme.colorScheme.onSurface,
                            unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                            focusedContainerColor = MaterialTheme.colorScheme.surface,
                            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                            focusedLabelColor = MaterialTheme.colorScheme.primary,
                            unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    )
                    TextButton(
                        onClick = onAddNewTag
                    ) {
                        Text(
                            text = "Add",
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }

                // Tag suggestions section
                TagSuggestionsContent(
                    tagSuggestionState = tagSuggestionState,
                    isTagSelected = { tag -> tagStates[tag] == true },
                    onToggleSuggestion = { suggestion, newValue ->
                        tagStates[suggestion] = newValue
                        viewStore.action { updateTag(article.itemId, suggestion, newValue) }
                    },
                    onRequestTagSuggestions = {
                        viewStore.action { requestTagSuggestions(article) }
                    },
                    modifier = Modifier.fillMaxWidth()
                )

                // Selected tags section
                val selectedTags = tagStates.filterValues { it }.keys.toList().sorted()
                if (selectedTags.isNotEmpty()) {
                    Text(
                        text = "Selected tags",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        selectedTags.forEach { tag ->
                            FilterChip(
                                selected = true,
                                onClick = {
                                    tagStates[tag] = false
                                    viewStore.action { updateTag(article.itemId, tag, false) }
                                },
                                label = {
                                    Text(
                                        text = tag,
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            )
                        }
                    }
                }

                // Available tags section (scrollable)
                Text(
                    text = "Available tags",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val availableUnselectedTags = (tagStates.keys + viewStore.state.tags)
                        .toSet()
                        .filter { tagStates[it] != true }
                        .sorted()
                    availableUnselectedTags.forEach { tag ->
                        FilterChip(
                            selected = false,
                            onClick = {
                                tagStates[tag] = true
                                viewStore.action { updateTag(article.itemId, tag, true) }
                            },
                            label = {
                                Text(
                                    text = tag,
                                    style = MaterialTheme.typography.labelMedium
                                )
                            },
                            colors = FilterChipDefaults.filterChipColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        )
                    }
                }
            }
        }
    }
}
