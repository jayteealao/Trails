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
    val isRead: Boolean = false,
    val tagsString: String? = "",
    val snippet: String? = null,
    val deletedAt: Long? = null,
    val archivedAt: Long? = null,
) {
    val domain: String by lazy {
        try {
            url.toHttpUrlOrNull()?.topPrivateDomain() ?: ""
        } catch (e: IllegalStateException) {
            // Fallback for preview mode where PublicSuffixDatabase is not available
            url.toHttpUrlOrNull()?.host ?: ""
        }
    }

    val tags: List<String> by lazy {
        tagsString?.split(",")?.map { it.trim() } ?: emptyList()
    }
}

val EMPTYARTICLEITEM = ArticleItem("", "", "")