package com.jayteealao.trails.network

import com.jayteealao.trails.network.dto.SignedUrlResponse
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Query
import retrofit2.http.Url

/**
 * Retrofit client for the per-user archive signed-URL endpoint
 * (`GET /app/signed-url`) on the `dashboardApi` Cloud Function.
 *
 * The absolute URL is supplied per call via [Url] so the Remote-Config-driven
 * base (see `RemoteConfigModule`) is applied without rebuilding Retrofit. The
 * caller passes a Firebase ID token as the `Authorization: Bearer` header; the
 * endpoint verifies it, confirms ownership, and returns a short-lived signed
 * GCS read URL.
 */
interface ArchiveUrlService {
    @GET
    suspend fun getSignedUrl(
        @Url url: String,
        @Header("Authorization") bearer: String,
        @Query("itemId") itemId: String,
        @Query("archiveKey") archiveKey: String,
    ): SignedUrlResponse
}
