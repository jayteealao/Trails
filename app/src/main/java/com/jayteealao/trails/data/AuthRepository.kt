package com.jayteealao.trails.data

import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class AuthRepository @Inject constructor(
    private val auth: FirebaseAuth
) {
    fun getCurrentUser(): FirebaseUser? {
        return auth.currentUser
    }

    suspend fun signInWithCredential(credential: AuthCredential): AuthResult {
        return auth.signInWithCredential(credential).await()
    }

    suspend fun signInAnonymously(): AuthResult {
        return auth.signInAnonymously().await()
    }

    suspend fun linkWithCredential(credential: AuthCredential): AuthResult {
        val currentUser = auth.currentUser
            ?: throw IllegalStateException("No current user to link")
        return currentUser.linkWithCredential(credential).await()
    }

    fun signOut() {
        auth.signOut()
    }
}
