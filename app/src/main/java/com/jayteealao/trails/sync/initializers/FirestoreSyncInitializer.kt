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

        // Check if user is authenticated
        auth.currentUser?.let { user ->
            Timber.d("User authenticated: ${user.uid}, scheduling sync")

            // Schedule periodic sync - first run will happen within 15 minutes
            // This prevents blocking the app startup for large datasets
            syncManager.schedulePeriodicSync()

            // For large datasets (11K+ articles), let WorkManager handle initial sync
            // instead of blocking app startup. User can manually trigger if needed.
            Timber.d("Sync scheduled via WorkManager - will run in background")
        } ?: run {
            Timber.d("No authenticated user, skipping sync initialization")
        }

        // Listen for auth state changes to handle sign-in/sign-out
        auth.addAuthStateListener { firebaseAuth ->
            val currentUser = firebaseAuth.currentUser

            if (currentUser != null) {
                Timber.d("User signed in: ${currentUser.uid}, scheduling background sync")

                // Schedule periodic sync (safe to call after WorkManager is initialized)
                // This syncs every 15 minutes using pagination to avoid memory issues
                // For large datasets, this prevents blocking the UI
                syncManager.schedulePeriodicSync()

                Timber.d("Background sync scheduled - user can manually trigger immediate sync if needed")
            } else {
                Timber.d("User signed out, stopping sync")
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
