package com.jayteealao.trails.di

import com.google.firebase.auth.FirebaseAuth
import com.jayteealao.trails.BuildConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import timber.log.Timber
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object FirebaseModule {

    @Provides
    @Singleton
    fun provideFirebaseAuth(): FirebaseAuth {
        return FirebaseAuth.getInstance().apply {
            // Debug builds can target the local Auth emulator (-Ptrails.authEmulator=host:port).
            val target = BuildConfig.AUTH_EMULATOR
            if (BuildConfig.DEBUG && target.isNotBlank()) {
                val host = target.substringBeforeLast(':', "")
                val port = target.substringAfterLast(':', "").toIntOrNull()
                if (host.isNotBlank() && port != null) {
                    useEmulator(host, port)
                } else {
                    Timber.w("Ignoring malformed Auth emulator address '%s'; using production", target)
                }
            }
        }
    }
}
