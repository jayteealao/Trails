package com.jayteealao.trails.common.di.dispatchers

import javax.inject.Qualifier

@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class Dispatcher(val trailsDispatcher: TrailsDispatchers)

enum class TrailsDispatchers {
    IO,
    MAIN,
    DEFAULT,
    UNCONFINED
}