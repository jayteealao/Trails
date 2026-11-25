package com.jayteealao.trails.data.account

import android.app.Application
import android.content.Context
import android.content.MutableContextWrapper
import android.os.Bundle
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The Credential Manager source of a Google account: one button-flow request, and a token back. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class GoogleSignInTest {

    private val credentialManager = mockk<CredentialManager>(relaxed = true)
    private val signIn = CredentialManagerGoogleSignIn(credentialManager, CLIENT_ID)
    private val activity: Context = RuntimeEnvironment.getApplication()

    /** A Google answer of [type] holding [token] for [EMAIL]. */
    private fun googleAnswer(type: String, token: String = TOKEN): GetCredentialResponse {
        val data = GoogleIdTokenCredential.Builder().setId(EMAIL).setIdToken(token).build().data
        return GetCredentialResponse(CustomCredential(type, data))
    }

    @Test
    fun theRequest_isOneSignInWithGoogleOption_withTheWebClientId() = runTest {
        val request = slot<GetCredentialRequest>()
        coEvery { credentialManager.getCredential(any<Context>(), capture(request)) } returns
            googleAnswer(GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL)

        signIn.account(activity)

        val options = request.captured.credentialOptions
        assertEquals(1, options.size)
        val option = options.single()
        assertTrue(option is GetSignInWithGoogleOption)
        assertEquals(CLIENT_ID, (option as GetSignInWithGoogleOption).serverClientId)
    }

    @Test
    fun bothTokenTypes_giveTheTokenAndTheEmail() = runTest {
        listOf(
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL,
        ).forEach { type ->
            coEvery { credentialManager.getCredential(any<Context>(), any<GetCredentialRequest>()) } returns
                googleAnswer(type)

            assertEquals(GoogleAccount(TOKEN, EMAIL), signIn.account(activity))
        }
    }

    @Test
    fun theActivity_isNotKeptAfterTheCall() = runTest {
        val context = slot<Context>()
        coEvery { credentialManager.getCredential(capture(context), any<GetCredentialRequest>()) } returns
            googleAnswer(GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)

        signIn.account(activity)

        val wrapper = context.captured as MutableContextWrapper
        assertSame(activity.applicationContext, wrapper.baseContext)
    }

    @Test
    fun aPasswordOrABrokenAnswer_isAnUnknownFailure() = runTest {
        listOf(
            GetCredentialResponse(PasswordCredential("mara", "secret")),
            GetCredentialResponse(CustomCredential(GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL, Bundle())),
            GetCredentialResponse(CustomCredential("com.example.OTHER", Bundle())),
        ).forEach { response ->
            coEvery { credentialManager.getCredential(any<Context>(), any<GetCredentialRequest>()) } returns response

            val thrown = runCatching { signIn.account(activity) }.exceptionOrNull()
            assertTrue("$response gave $thrown", thrown is GetCredentialUnknownException)
        }
    }

    @Test
    fun noAccountAndACancel_passThrough() = runTest {
        listOf(NoCredentialException(), GetCredentialCancellationException()).forEach { failure ->
            coEvery { credentialManager.getCredential(any<Context>(), any<GetCredentialRequest>()) } throws failure

            val thrown = runCatching { signIn.account(activity) }.exceptionOrNull()
            assertSame(failure, thrown)
        }
    }

    @Test
    fun forget_clearsTheCredentialStateOnce() = runTest {
        signIn.forget()

        coVerify(exactly = 1) { credentialManager.clearCredentialState(any()) }
    }

    @Test
    fun theEmulatorSource_isOffWithNoEmulator() {
        assertEquals(null, emulatorGoogleSignIn(""))
        assertEquals(null, emulatorGoogleSignIn("  "))
    }

    private companion object {
        const val CLIENT_ID = "web-client-id.apps.googleusercontent.com"
        const val EMAIL = "mara@example.org"

        // An unsigned token with the parts a Google ID token has; nothing reads the signature.
        const val TOKEN = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwiZW1haWwiOiJtYXJhQGV4YW1wbGUub3JnIn0.c2ln" // gitleaks:allow
    }
}
