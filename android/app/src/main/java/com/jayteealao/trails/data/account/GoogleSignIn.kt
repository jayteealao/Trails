package com.jayteealao.trails.data.account

import android.content.Context
import android.content.MutableContextWrapper
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.Credential
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialUnknownException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** The Google account the person picked: the token Firebase signs in with, and its address. */
data class GoogleAccount(val idToken: String, val email: String)

/** The source of a Google account for sign-in and for the account upgrade. */
interface GoogleSignIn {
    /**
     * Asks the person to pick a Google account. [activity] shows the picker and is used for
     * this call only. Throws a `GetCredentialException` when no account comes back; a
     * cancelled coroutine closes the picker.
     */
    suspend fun account(activity: Context): GoogleAccount

    /** Tells the credential providers that the person signed out. */
    suspend fun forget()
}

/** The Google account picker of Credential Manager (the "Sign in with Google" button flow). */
class CredentialManagerGoogleSignIn(
    private val credentialManager: CredentialManager,
    private val serverClientId: String,
) : GoogleSignIn {

    override suspend fun account(activity: Context): GoogleAccount {
        // The wrapper is pointed away from the activity when the call ends, so a provider
        // that keeps the context does not keep a finished activity alive.
        val context = MutableContextWrapper(activity)
        try {
            val response = credentialManager.getCredential(context, request())
            return googleAccountOf(response.credential)
        } finally {
            context.baseContext = activity.applicationContext
        }
    }

    override suspend fun forget() {
        credentialManager.clearCredentialState(ClearCredentialStateRequest())
    }

    internal fun request(): GetCredentialRequest = GetCredentialRequest(
        listOf(GetSignInWithGoogleOption.Builder(serverClientId).build())
    )
}

private val GOOGLE_TOKEN_TYPES = setOf(
    GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
    GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL,
)

/** Reads the Google token out of [credential]; anything else is an unknown failure. */
internal fun googleAccountOf(credential: Credential): GoogleAccount {
    if (credential !is CustomCredential || credential.type !in GOOGLE_TOKEN_TYPES) {
        throw GetCredentialUnknownException("The answer was not a Google account")
    }
    val google = try {
        GoogleIdTokenCredential.createFrom(credential.data)
    } catch (e: Exception) {
        throw GetCredentialUnknownException("The Google account could not be read").apply { initCause(e) }
    }
    return GoogleAccount(idToken = google.idToken, email = google.id)
}
