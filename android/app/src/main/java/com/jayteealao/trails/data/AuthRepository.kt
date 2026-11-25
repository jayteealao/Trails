package com.jayteealao.trails.data

import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import java.util.concurrent.TimeoutException
import javax.inject.Inject

class AuthRepository @Inject constructor(
    private val auth: FirebaseAuth
) {
    fun getCurrentUser(): FirebaseUser? {
        return auth.currentUser
    }

    suspend fun signInAnonymously(): AuthResult {
        return try {
            withTimeout(10000) {  // 10 second timeout
                auth.signInAnonymously().await()
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            throw TimeoutException("The guest sign-in did not answer in time").apply { initCause(e) }
        }
    }

    /** Signs in to Firebase with the Google [idToken]. */
    suspend fun signInWithGoogle(idToken: String): AuthResult {
        return auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
    }

    /** Adds the Google account of [idToken] to the signed-in user, which keeps its uid. */
    suspend fun linkGoogle(idToken: String): AuthResult {
        val currentUser = auth.currentUser
            ?: throw IllegalStateException("No current user to link")
        return currentUser.linkWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
    }

    fun signOut() {
        auth.signOut()
    }
}
