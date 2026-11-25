package com.jayteealao.trails.di

import android.content.Context
import androidx.credentials.CredentialManager
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.R
import com.jayteealao.trails.data.account.CredentialManagerGoogleSignIn
import com.jayteealao.trails.data.account.GoogleSignIn
import com.jayteealao.trails.data.account.emulatorGoogleSignIn
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object SignInModule {

    @Provides
    @Singleton
    fun provideCredentialManager(@ApplicationContext context: Context): CredentialManager =
        CredentialManager.create(context)

    @Provides
    @Singleton
    fun provideGoogleSignIn(
        @ApplicationContext context: Context,
        credentialManager: CredentialManager,
    ): GoogleSignIn = emulatorGoogleSignIn(BuildConfig.AUTH_EMULATOR)
        ?: CredentialManagerGoogleSignIn(credentialManager, context.getString(R.string.default_web_client_id))
}
