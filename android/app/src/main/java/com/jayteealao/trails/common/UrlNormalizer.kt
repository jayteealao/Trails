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
 * query params, sorts remaining query params by name, and removes trailing slash
 * from non-root paths. A route fragment (one whose text after '#' starts with "/"
 * or "!", as in hash-routed `#/watch?v=…` and hashbang `#!…` URLs) is kept as
 * OkHttp parsed and encoded it, because it names the page; every other fragment
 * is removed.
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

    // newBuilder() carries the parsed encodedFragment; keep it only for a route fragment.
    val builder = httpUrl.newBuilder()
        .query(null)
    if (!isRouteFragment(httpUrl.encodedFragment)) {
        builder.fragment(null)
    }

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

/** A fragment that carries the page identity: `#/…` (hash routing) or `#!…` (hashbang). */
private fun isRouteFragment(encodedFragment: String?): Boolean =
    encodedFragment != null && (encodedFragment.startsWith("/") || encodedFragment.startsWith("!"))
