package com.jayteealao.trails.screens.articleList

data class TagSuggestionUiState(
    val isLoading: Boolean = false,
    val tags: List<String> = emptyList(),
    val errorMessage: String? = null,
    val requestSignature: String? = null,
)
