package com.jayteealao.trails.screens.share

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Binds the saver of shared links, kept beside the share sheet so the data layer does not depend on it. */
@Module
@InstallIn(SingletonComponent::class)
interface ShareModule {

    @Singleton
    @Binds
    fun bindsLinkSaver(
        linkSaver: DefaultLinkSaver
    ): LinkSaver
}
