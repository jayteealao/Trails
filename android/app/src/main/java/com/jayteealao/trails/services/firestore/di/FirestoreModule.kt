package com.jayteealao.trails.services.firestore.di

import android.content.Context
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.services.firestore.FirestoreCacheReset
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import timber.log.Timber
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object FirestoreModule {

    @Provides
    @Singleton
    fun provideFirebaseFirestore(@ApplicationContext context: Context): FirebaseFirestore {
        return FirebaseFirestore.getInstance().apply {
            // Debug builds can target the local Firestore emulator (-Ptrails.firestoreEmulator=host:port).
            // useEmulator must run before the settings are assigned.
            val target = BuildConfig.FIRESTORE_EMULATOR
            if (BuildConfig.DEBUG && target.isNotBlank()) {
                val host = target.substringBeforeLast(':', "")
                val port = target.substringAfterLast(':', "").toIntOrNull()
                if (host.isNotBlank() && port != null) {
                    useEmulator(host, port)
                } else {
                    Timber.w("Ignoring malformed Firestore emulator address '%s'; using production", target)
                }
            }
            firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setPersistenceEnabled(true)
                .setCacheSizeBytes(FirebaseFirestoreSettings.CACHE_SIZE_UNLIMITED)
                .build()
            // After "Clear data" or an account switch, drop the previous account's cached
            // documents before this instance serves any read.
            FirestoreCacheReset.clearIfRequested(context, this)
        }
    }
}
