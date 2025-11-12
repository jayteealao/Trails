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

            // Start real-time sync
            syncManager.startRealtimeSync()

            // Perform initial full sync
            ProcessLifecycleOwner.get().lifecycleScope.launch {
                try {
                    syncManager.performFullSync()
                } catch (e: Exception) {
                    Timber.e(e, "Initial sync failed")
                }
            }
        } ?: run {
            Timber.d("No authenticated user, skipping sync initialization")
        }

        // Listen for auth state changes
        auth.addAuthStateListener { firebaseAuth ->
            if (firebaseAuth.currentUser != null) {
                Timber.d("User signed in, starting sync")
                syncManager.startRealtimeSync()

                ProcessLifecycleOwner.get().lifecycleScope.launch {
                    try {
                        syncManager.performFullSync()
                    } catch (e: Exception) {
                        Timber.e(e, "Sync after sign-in failed")
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
