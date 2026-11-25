package com.jayteealao.trails

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** The words in the search field, kept while the person moves between screens. */
class SearchBarState {

    var searchText by mutableStateOf("")

    fun updateSearchText(text: String) {
        searchText = text
    }
}
