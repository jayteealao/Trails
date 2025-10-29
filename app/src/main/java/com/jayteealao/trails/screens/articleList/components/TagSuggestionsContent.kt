package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.articleList.TagSuggestionUiState

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagSuggestionsContent(
    tagSuggestionState: TagSuggestionUiState,
    isTagSelected: (String) -> Boolean,
    onToggleSuggestion: (String, Boolean) -> Unit,
    onRequestTagSuggestions: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasSuggestionContent =
        tagSuggestionState.tags.isNotEmpty() ||
            !tagSuggestionState.summary.isNullOrBlank() ||
            !tagSuggestionState.lede.isNullOrBlank() ||
            tagSuggestionState.faviconUrl != null ||
            tagSuggestionState.imageUrls.isNotEmpty() ||
            tagSuggestionState.videoUrls.isNotEmpty()

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (tagSuggestionState.isLoading && !hasSuggestionContent) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
                Text(
                    text = "Fetching tag suggestions…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val requestButtonLabel = if (tagSuggestionState.errorMessage != null) {
                    "Retry suggestions"
                } else {
                    "Refresh suggestions"
                }
                Button(
                    onClick = onRequestTagSuggestions,
                    enabled = !tagSuggestionState.isLoading
                ) {
                    Text(text = requestButtonLabel)
                }
                if (tagSuggestionState.isLoading) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = "Refreshing…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        tagSuggestionState.errorMessage?.let { message ->
            Text(
                text = message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
        }

        val summary = tagSuggestionState.summary
        if (!summary.isNullOrBlank()) {
            Text(
                text = "Editorial summary",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        val lede = tagSuggestionState.lede
        if (!lede.isNullOrBlank()) {
            Text(
                text = "Lede",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = lede,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        tagSuggestionState.faviconUrl?.let { faviconUrl ->
            Text(
                text = "Favicon",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = faviconUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        if (tagSuggestionState.imageUrls.isNotEmpty()) {
            Text(
                text = "Images",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                tagSuggestionState.imageUrls.forEach { url ->
                    AssistChip(
                        onClick = {},
                        enabled = false,
                        label = {
                            Text(
                                text = url,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    )
                }
            }
        }

        if (tagSuggestionState.videoUrls.isNotEmpty()) {
            Text(
                text = "Videos",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                tagSuggestionState.videoUrls.forEach { url ->
                    AssistChip(
                        onClick = {},
                        enabled = false,
                        label = {
                            Text(
                                text = url,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    )
                }
            }
        }

        if (tagSuggestionState.tags.isNotEmpty()) {
            Text(
                text = "Suggested tags",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                tagSuggestionState.tags.forEach { suggestion ->
                    val isSelected = isTagSelected(suggestion)
                    FilterChip(
                        selected = isSelected,
                        onClick = {
                            val newValue = !isSelected
                            onToggleSuggestion(suggestion, newValue)
                        },
                        label = {
                            Text(
                                text = suggestion,
                                style = MaterialTheme.typography.labelMedium
                            )
                        },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    )
                }
            }
        }
    }
}
