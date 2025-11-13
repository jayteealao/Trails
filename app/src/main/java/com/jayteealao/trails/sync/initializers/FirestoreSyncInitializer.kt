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
 * Starts real-time sync listener if user is authenticated
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
            Timber.d("User authenticated: ${user.uid}, starting sync")

            // Start real-time sync listener
            syncManager.startRealtimeSync()

            // Perform initial full sync in background
            ProcessLifecycleOwner.get().lifecycleScope.launch {
                try {
                    Timber.d("Starting initial full sync")
                    syncManager.performFullSync()
                    Timber.d("Initial full sync completed successfully")
                } catch (e: Exception) {
                    Timber.e(e, "Initial sync failed: ${e.message}")
                    // Error will be reflected in syncStatus StateFlow for UI
                }
            }
        } ?: run {
            Timber.d("No authenticated user, skipping sync initialization")
        }

        // Listen for auth state changes to handle sign-in/sign-out
        auth.addAuthStateListener { firebaseAuth ->
            val currentUser = firebaseAuth.currentUser

            if (currentUser != null) {
                Timber.d("User signed in: ${currentUser.uid}, starting sync")

                // Start real-time sync listener
                syncManager.startRealtimeSync()

                // Perform full sync after sign-in
                ProcessLifecycleOwner.get().lifecycleScope.launch {
                    try {
                        Timber.d("Starting full sync after sign-in")
                        syncManager.performFullSync()
                        Timber.d("Sync after sign-in completed successfully")
                    } catch (e: Exception) {
                        Timber.e(e, "Sync after sign-in failed: ${e.message}")
                        // Error will be reflected in syncStatus StateFlow for UI
                    }
                }
            } else {
                Timber.d("User signed out, stopping sync")
                syncManager.stopRealtimeSync()
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
