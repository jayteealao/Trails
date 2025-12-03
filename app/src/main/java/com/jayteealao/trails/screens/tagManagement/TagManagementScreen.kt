package com.jayteealao.trails.screens.tagManagement

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jayteealao.trails.screens.tagManagement.TagSuggestionUiState
import io.yumemi.tartlet.rememberViewStore

/**
 * Tag Management Screen - Content only (no ModalBottomSheet wrapper)
 * The BottomSheetSceneStrategy handles the sheet presentation
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TagManagementScreen(
    articleId: String,
    tagManagementViewModel: TagManagementViewModel = hiltViewModel()
) {
    // Create ViewStore from ViewModel
    val viewStore = rememberViewStore { tagManagementViewModel }

    // Fetch the article
    LaunchedEffect(articleId) {
        tagManagementViewModel.getArticle(articleId)
    }

    val article = viewStore.state.article

    // Show loading or wait for article to load
    if (article == null) {
        // Could show a loading indicator here
        return
    }

    // Local state for tag management
    val tagStates = remember(article.itemId) {
        mutableMapOf<String, Boolean>().apply {
            article.tagsString?.split(",")?.forEach { tag ->
                if (tag.isNotBlank()) put(tag.trim(), true)
            }
        }
    }
    var newTagText by remember { mutableStateOf("") }

    val tagSuggestionState: TagSuggestionUiState = viewStore.state.tagSuggestionStates[article.itemId]
        ?: TagSuggestionUiState()

    // Content only - BottomSheetSceneStrategy wraps this in ModalBottomSheet
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
                onValueChange = { newTagText = it },
                label = { Text(text = "New tag") },
                modifier = Modifier.weight(1f),
                singleLine = true
            )
            Button(
                onClick = {
                    if (newTagText.isNotBlank()) {
                        tagStates[newTagText.trim()] = true
                        viewStore.action { updateTag(article.itemId, newTagText.trim(), true) }
                        newTagText = ""
                    }
                }
            ) {
                Text(text = "Add")
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
