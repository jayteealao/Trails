package com.jayteealao.trails.di

import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Remote Config key for the archive signed-URL endpoint base URL. */
const val ARCHIVE_SIGNED_URL_BASE_KEY = "archive_signed_url_base"

/**
 * Default base URL for the `dashboardApi` Cloud Function. Baked in so the very
 * first launch — before Remote Config finishes fetching/activating — still
 * resolves a working endpoint. A Remote Config override applies on the next
 * read without an app rebuild.
 */
const val DEFAULT_DASHBOARD_API_URL =
    "https://us-central1-trails-e428e.cloudfunctions.net/dashboardApi"

@Module
@InstallIn(SingletonComponent::class)
object RemoteConfigModule {

    @Provides
    @Singleton
    fun provideFirebaseRemoteConfig(): FirebaseRemoteConfig {
        return FirebaseRemoteConfig.getInstance().apply {
            setDefaultsAsync(mapOf(ARCHIVE_SIGNED_URL_BASE_KEY to DEFAULT_DASHBOARD_API_URL))
            // Kick off a fetch+activate at provide time; the baked default covers
            // the window before it completes.
            fetchAndActivate()
        }
    }
}
