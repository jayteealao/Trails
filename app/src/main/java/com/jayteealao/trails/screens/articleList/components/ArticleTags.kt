package com.jayteealao.trails.screens.articleList.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagSection(
    tagStates: MutableMap<String, Boolean>,
    onTagToggle: (String, Boolean) -> Unit,
    onAddTag: () -> Unit,
    modifier: Modifier = Modifier
) {
    FlowRow(
        modifier = modifier
            .wrapContentHeight(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        val tagsInDisplay = tagStates.filterValues { it }.keys.toList().sorted()
        tagsInDisplay.forEach { tag ->
            val selected = tagStates[tag] ?: false
            FilterChip(
                selected = selected,
                onClick = onAddTag,
                label = {
                    Text(text = tag, style = MaterialTheme.typography.labelSmall)
                },
                modifier = Modifier
                    .height(28.dp)
                    .padding(bottom = 8.dp),
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primary.copy(
                        alpha = 0.16f
                    ),
                    selectedLabelColor = MaterialTheme.colorScheme.primary
                )
            )
        }
        FilterChip(
            selected = false,
            onClick = onAddTag,
            label = { Text(text = "") },
            leadingIcon = {
                Icon(
                    painter = painterResource(id = R.drawable.add_24px),
                    contentDescription = "Add tag",
                    modifier = Modifier
                        .size(20.dp)
                        .wrapContentHeight()
                )
            },
            modifier = Modifier
                .height(28.dp)
                .padding(bottom = 8.dp)
                .align(Alignment.Top),
            border = FilterChipDefaults.filterChipBorder(
                borderColor = Color.Transparent,
                selectedBorderColor = Color.Transparent,
                disabledBorderColor = Color.Transparent,
                disabledSelectedBorderColor = Color.Transparent,
                enabled = true,
                selected = false
            ),
            colors = FilterChipDefaults.filterChipColors(
                selectedContainerColor = Color.Transparent,
                selectedLabelColor = Color.Transparent
            )
        )
    }
}