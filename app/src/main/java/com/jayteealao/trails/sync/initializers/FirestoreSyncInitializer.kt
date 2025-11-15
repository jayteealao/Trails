package com.jayteealao.trails.sync.initializers

import android.content.Context
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.startup.Initializer
import com.google.firebase.auth.FirebaseAuth
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Initializes Firestore sync on app startup
 * Uses periodic background sync (every 15 minutes) with pagination to avoid OOM
 * Real-time sync listener is disabled for large datasets
 */
class FirestoreSyncInitializer : Initializer<Unit> {

    override fun create(context: Context) {
        Timber.d("Initializing Firestore sync")

        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            FirestoreSyncInitializerEntryPoint::class.java
        )

        val syncManager = entryPoint.firestoreSyncManager()
        val auth = entryPoint.firebaseAuth()

        // NOTE: We do NOT schedule WorkManager tasks here!
        // AndroidX Startup runs BEFORE Application.onCreate(), which means Hilt hasn't
        // injected dependencies yet. WorkManager needs HiltWorkerFactory which is a
        // lateinit var that won't be initialized until after Hilt injection completes.
        // Scheduling is handled in Application.onCreate() instead.

        // Check if user is authenticated (just for logging)
        auth.currentUser?.let { user ->
            Timber.d("User authenticated: ${user.uid}")
        } ?: run {
            Timber.d("No authenticated user")
        }

        // Listen for auth state changes to handle sign-in/sign-out
        // NOTE: We only cancel sync on sign-out. Scheduling happens in Application.onCreate()
        auth.addAuthStateListener { firebaseAuth ->
            val currentUser = firebaseAuth.currentUser

            if (currentUser != null) {
                Timber.d("User signed in: ${currentUser.uid}")
                // Sync scheduling is handled by Application.onCreate() after Hilt injection
            } else {
                Timber.d("User signed out, stopping sync")
                // Safe to cancel - WorkManager is already initialized at this point
                syncManager.cancelPeriodicSync()
            }
        }
    }

    override fun dependencies(): List<Class<out Initializer<*>>> {
        return emptyList()
    }

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface FirestoreSyncInitializerEntryPoint {
        fun firestoreSyncManager(): FirestoreSyncManager
        fun firebaseAuth(): FirebaseAuth
    }
}
