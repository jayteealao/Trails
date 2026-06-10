package com.jayteealao.trails.network.dto

import com.google.gson.annotations.SerializedName

/**
 * Response from the `GET /app/signed-url` Cloud Function endpoint.
 *
 * Only [url] is consumed by the client (the short-lived V4 signed GCS read
 * URL). The remaining fields mirror the handler response shape for parity /
 * debugging and are optional so a shape change never breaks parsing of [url].
 */
data class SignedUrlResponse(
    @SerializedName("url") val url: String,
    @SerializedName("expires_at") val expiresAt: String? = null,
    @SerializedName("item_id") val itemId: String? = null,
    @SerializedName("canonical_item_id") val canonicalItemId: String? = null,
    @SerializedName("archive_key") val archiveKey: String? = null,
    @SerializedName("archive_source_key") val archiveSourceKey: String? = null,
)
