package com.jayteealao.trails.data.models

import androidx.compose.runtime.Stable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@Stable
data class ArticleItem(
    val itemId: String,
    val title: String,
    val url: String,
    val tagsString: String = "",
    val snippet: String? = null,
) {
    val domain: String by lazy {
        url.toHttpUrlOrNull()?.topPrivateDomain() ?: ""
    }

    val tags: List<String> by lazy {
        tagsString.split(",").map { it.trim() }
    }
}

val EMPTYARTICLEITEM = ArticleItem("", "", "")