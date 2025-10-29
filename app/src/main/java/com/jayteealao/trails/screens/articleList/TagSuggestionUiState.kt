package com.jayteealao.trails.screens.articleList

data class TagSuggestionUiState(
    val isLoading: Boolean = false,
    val tags: List<String> = emptyList(),
    val summary: String? = null,
    val lede: String? = null,
    val faviconUrl: String? = null,
    val imageUrls: List<String> = emptyList(),
    val videoUrls: List<String> = emptyList(),
    val errorMessage: String? = null,
    val requestSignature: String? = null,
)
