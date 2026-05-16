package com.jayteealao.trails.common

import timber.log.Timber

@Suppress("PrivatePropertyName")
class UrlModifier {
    // Regex patterns
    private val URLCHECKPATTERN = Regex(
        pattern = "(https?://)?(www\\.)?(towardsdatascience\\.com|medium\\.com|proandroiddev\\.com)"
    )
    private val PROTOCOL_PATTERN = Regex("^https?://")

    /**
     * Modifies URLs for Medium-based websites to use freedium.cfd
     *
     * @param url The input URL to potentially modify
     * @return Modified URL if it matches the pattern, original URL otherwise
     * @throws IllegalArgumentException if the URL is blank or malformed
     */
    fun modifyUrl(url: String): String {
        // Validate input
        if (url.isBlank()) {
            throw IllegalArgumentException("URL cannot be blank")
        }

        return try {
            if (URLCHECKPATTERN.containsMatchIn(url)) {
                // Remove any existing protocol
                val urlWithoutProtocol = url.replace(PROTOCOL_PATTERN, "")
                "https://freedium.cfd/$urlWithoutProtocol".also {
                    Timber.d("Modified URL: $it")
                }
            } else {
                url
            }
        } catch (e: Exception) {
            Timber.e(e, "Error modifying URL: ${e.message}")
            url // Return original URL in case of any error
        }
    }
}