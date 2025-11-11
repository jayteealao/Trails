package com.jayteealao.trails

import androidx.compose.animation.animateColor
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.updateTransition
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

class SearchBarState(
    searchBarActive: Boolean,
    private val onSearch: (String) -> Unit = { },
) {

    var searchText by mutableStateOf("")

    var searchBarActive by mutableStateOf(searchBarActive)
    private val transition: Transition<Boolean>? = null

    @Composable
    fun rememberSearchBarTransition(): Transition<Boolean> {
        return transition ?: updateTransition(targetState = searchBarActive, label = "searchBarTransition")
    }

    fun updateSearchText(text: String) {
        searchText = text
    }

    @Composable
    fun searchBarContainerColor(): State<androidx.compose.ui.graphics.Color> {
        return rememberSearchBarTransition().animateColor(label = "searchBarContainerColor") {
            if (it) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            }
        }
    }

    fun search() {
        onSearch(searchText)
    }
}
