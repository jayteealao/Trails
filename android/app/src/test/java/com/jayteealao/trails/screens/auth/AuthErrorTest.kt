package com.jayteealao.trails.screens.auth

import android.app.Application
import android.content.Context
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.OwnerDecision
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.screens.components.ErrorMessage
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeoutException

/** A failed sign-in says why once, in fixed words, whichever way it failed. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class AuthErrorTest {

    private val offlineCauses = listOf(
        FirebaseNetworkException(RAW),
        TimeoutException(RAW),
        RuntimeException(RAW, FirebaseNetworkException(RAW)),
        GetCredentialUnknownException(RAW).apply { initCause(FirebaseNetworkException(RAW)) },
    )
    private val otherCauses = listOf(
        IllegalStateException(RAW),
        GetCredentialProviderConfigurationException(RAW),
    )

    @Test
    fun eachCause_hasItsWords() {
        offlineCauses.forEach { assertEquals(ErrorMessage.SIGN_IN_OFFLINE, signInErrorOf(it)) }
        otherCauses.forEach { assertEquals(ErrorMessage.SIGN_IN_FAILED, signInErrorOf(it)) }
    }

    @Test
    fun everyWayToSignIn_endsInItsState() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val repository = mockk<AuthRepository> {
                every { getCurrentUser() } returns null
                coEvery { signInAnonymously() } throws TimeoutException(RAW)
                coEvery { signInWithGoogle(FakeGoogleSignIn.TOKEN) } throws FirebaseNetworkException(RAW)
            }
            val network = mockk<NetworkMonitor> { every { isOnline } returns flowOf(true) }
            val viewModel = AuthViewModel(
                repository, mockk<LocalDataOwner>(), mockk<PushThenWipe>(), FakeGoogleSignIn(), network,
            )

            viewModel.signInAnonymously()
            advanceUntilIdle()
            assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_OFFLINE), viewModel.state.value)

            viewModel.signInWithGoogle(mockk<Context>())
            advanceUntilIdle()
            assertEquals(AuthUiState.Error(ErrorMessage.GOOGLE_OFFLINE), viewModel.state.value)

            coEvery { repository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } throws IllegalStateException(RAW)
            viewModel.signInWithGoogle(mockk<Context>())
            advanceUntilIdle()
            assertEquals(
                AuthUiState.Error(ErrorMessage.GOOGLE_FAILED, account = FakeGoogleSignIn.EMAIL),
                viewModel.state.value,
            )
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun failedLink_keepsTheGuestSignedIn_andSaysSoOnce() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val guest = mockk<FirebaseUser> {
                every { uid } returns "guest"
                every { email } returns null
            }
            val repository = mockk<AuthRepository> {
                every { getCurrentUser() } returns guest
                coEvery { linkGoogle(FakeGoogleSignIn.TOKEN) } throws IllegalStateException(RAW)
            }
            val owner = mockk<LocalDataOwner>(relaxed = true) {
                every { decide("guest") } returns OwnerDecision.SAME_OWNER
            }
            val network = mockk<NetworkMonitor> { every { isOnline } returns flowOf(true) }
            val viewModel = AuthViewModel(repository, owner, mockk<PushThenWipe>(), FakeGoogleSignIn(), network)
            val events = mutableListOf<AuthEvent>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.event.collect { events += it } }

            viewModel.upgradeAccount(mockk<Context>())
            advanceUntilIdle()

            assertEquals(AuthUiState.SignedIn(guest), viewModel.state.value)
            assertEquals(listOf<AuthEvent>(AuthEvent.UpgradeFailed(ErrorMessage.UPGRADE_FAILED)), events)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun noWordsEverCarryTheExceptionText() {
        (offlineCauses + otherCauses).forEach { cause ->
            listOfNotNull(
                signInErrorOf(cause),
                googleSignInErrorOf(cause, online = true),
                googleSignInErrorOf(cause, online = false),
                upgradeErrorOf(cause, online = true),
            ).forEach { message ->
                assertEquals(false, signInText(message, account = null).contains(RAW))
            }
        }
    }

    private companion object {
        const val RAW = "raw text of the exception"
    }
}
