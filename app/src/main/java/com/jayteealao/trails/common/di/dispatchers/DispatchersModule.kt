package com.jayteealao.trails.common.di.dispatchers

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
object DispatchersModule {

    @Provides
    @Dispatcher(TrailsDispatchers.IO)
    fun provideIODispatcher() = kotlinx.coroutines.Dispatchers.IO

    @Provides
    @Dispatcher(TrailsDispatchers.MAIN)
    fun provideMainDispatcher() = kotlinx.coroutines.Dispatchers.Main

    @Provides
    @Dispatcher(TrailsDispatchers.DEFAULT)
    fun provideDefaultDispatcher() = kotlinx.coroutines.Dispatchers.Default

    @Provides
    @Dispatcher(TrailsDispatchers.UNCONFINED)
    fun provideUnconfinedDispatcher() = kotlinx.coroutines.Dispatchers.Unconfined

}