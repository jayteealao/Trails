package com.jayteealao.trails.screens.tagManagement

data class TagSuggestionUiState(
    val isLoading: Boolean = false,
    val tags: List<String> = emptyList(),
    val errorMessage: String? = null,
    val requestSignature: String? = null,
)