package com.jayteealao.trails.data.local.database

import com.jayteealao.trails.common.normalizeUrl

/**
 * Computes the normalized URL for deduplication using the article's resolved URL
 * (url field preferred; falls back to givenUrl; empty string if both null).
 * Delegates to [normalizeUrl] — output is byte-identical to the inline expression
 * `normalizeUrl(article.url ?: article.givenUrl ?: "")`.
 */
fun Article.computeNormalizedUrl(): String =
    normalizeUrl(this.url ?: this.givenUrl ?: "")
