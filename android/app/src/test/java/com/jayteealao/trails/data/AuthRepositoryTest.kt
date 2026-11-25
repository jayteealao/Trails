package com.jayteealao.trails.data

import android.app.Application
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A Google token becomes a Google credential: a sign-in, or a link to the user who is signed in. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class AuthRepositoryTest {

    private val result = mockk<AuthResult>()
    private val auth = mockk<FirebaseAuth>()
    private val repository = AuthRepository(auth)

    @Test
    fun signInWithGoogle_signsInWithAGoogleCredential() = runTest {
        val credential = slot<AuthCredential>()
        every { auth.signInWithCredential(capture(credential)) } returns Tasks.forResult(result)

        assertSame(result, repository.signInWithGoogle(TOKEN))

        assertEquals("google.com", credential.captured.provider)
        verify(exactly = 1) { auth.signInWithCredential(any()) }
    }

    @Test
    fun linkGoogle_linksTheCurrentUser() = runTest {
        val credential = slot<AuthCredential>()
        val guest = mockk<FirebaseUser> {
            every { linkWithCredential(capture(credential)) } returns Tasks.forResult(result)
        }
        every { auth.currentUser } returns guest

        assertSame(result, repository.linkGoogle(TOKEN))

        assertEquals("google.com", credential.captured.provider)
        verify(exactly = 0) { auth.signInWithCredential(any()) }
    }

    @Test
    fun linkGoogle_withNobodySignedIn_throws() = runTest {
        every { auth.currentUser } returns null

        val thrown = runCatching { repository.linkGoogle(TOKEN) }.exceptionOrNull()

        assertTrue(thrown is IllegalStateException)
    }

    private companion object {
        const val TOKEN = "google-id-token"
    }
}
