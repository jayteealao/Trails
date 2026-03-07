package com.jayteealao.trails.common

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

private val TRACKING_PARAMS = setOf(
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid",
    "mc_cid", "mc_eid",
    "ref_src", "ref_url",
)

/**
 * Normalizes a URL for deduplication: lowercases scheme/host, strips tracking
 * query params and fragment, sorts remaining query params by name, and removes
 * trailing slash from non-root paths.
 * Returns the original string unchanged if it cannot be parsed.
 */
fun normalizeUrl(url: String): String {
    val httpUrl = url.toHttpUrlOrNull() ?: return url

    // Collect non-tracking query params
    val queryParams = mutableListOf<Pair<String, String?>>()
    for (name in httpUrl.queryParameterNames) {
        if (name.lowercase() in TRACKING_PARAMS) continue
        for (value in httpUrl.queryParameterValues(name)) {
            queryParams.add(name to value)
        }
    }

    // Sort by param name for canonical ordering
    queryParams.sortBy { it.first }

    val builder = httpUrl.newBuilder()
        .fragment(null)
        .query(null)

    // Remove trailing slash from non-root paths before adding query params
    val path = httpUrl.encodedPath
    if (path != "/" && path.endsWith("/")) {
        builder.encodedPath(path.dropLast(1))
    }

    for ((name, value) in queryParams) {
        if (value != null) {
            builder.addQueryParameter(name, value)
        } else {
            builder.addEncodedQueryParameter(name, null)
        }
    }

    return builder.build().toString()
}
