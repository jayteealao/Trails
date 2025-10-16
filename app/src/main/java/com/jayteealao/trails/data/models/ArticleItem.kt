package com.jayteealao.trails.data.models

import androidx.compose.runtime.Stable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@Stable
data class ArticleItem(
    val itemId: String,
    val title: String,
    val url: String,
    val image: String? = null,
    val favorite: Boolean = false,
    val tagsString: String? = "",
    val snippet: String? = null,
    val deletedAt: Long? = null,
    val archivedAt: Long? = null,
) {
    val domain: String by lazy {
        url.toHttpUrlOrNull()?.topPrivateDomain() ?: ""
    }

    val tags: List<String> by lazy {
        tagsString?.split(",")?.map { it.trim() } ?: emptyList()
    }
}

val EMPTYARTICLEITEM = ArticleItem("", "", "")