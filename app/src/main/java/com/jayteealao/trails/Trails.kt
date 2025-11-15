/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.jayteealao.trails

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import com.google.firebase.auth.FirebaseAuth
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.Dispatchers
import okio.Path.Companion.toOkioPath
import timber.log.Timber
import javax.inject.Inject

@HiltAndroidApp
class Trails @Inject constructor() : Application(), Configuration.Provider, SingletonImageLoader.Factory {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var firestoreSyncManager: FirestoreSyncManager
    @Inject lateinit var auth: FirebaseAuth

//    override val workManagerConfiguration: Configuration = Configuration.Builder()


    override fun onCreate() {
        super.onCreate()
//        Sync.initialize(context = this)
        Timber.plant(Timber.DebugTree())

        // Schedule periodic sync after WorkManager is fully initialized
        // Only schedule if user is authenticated
        auth.currentUser?.let {
            Timber.d("User authenticated, scheduling periodic sync")
            firestoreSyncManager.schedulePeriodicSync()
        }
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()

    override fun newImageLoader(context: PlatformContext): ImageLoader {
        return ImageLoader.Builder(context)
            .diskCache {
                DiskCache.Builder()
                    .maxSizePercent(0.10) // Adjust as needed
                    .directory(context.cacheDir.resolve("image_cache").toOkioPath())
                    .build()
            }
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizePercent(context, 0.25) // Adjust as needed
                    .build()
            }
            .coroutineContext(Dispatchers.IO)
            .build()
    }
}
