package com.jayteealao.trails.screens.auth

import android.app.Application
import android.content.Context
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.LocalDataReset
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.screens.components.ErrorMessage
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.TimeoutException

/**
 * Sign-in through Credential Manager: each way it fails has its own state, a cancel keeps what
 * was there, one attempt runs at a time, a stopped attempt signs its late account out, and a
 * start with a stored session signs nobody out.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class SignInFlowTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var prefs: SharedPreferencesManager
    private lateinit var authRepository: AuthRepository
    private lateinit var owner: LocalDataOwner
    private lateinit var reset: LocalDataReset
    private lateinit var google: FakeGoogleSignIn
    private val online = MutableStateFlow(true)
    private val network = mockk<NetworkMonitor> { every { isOnline } returns online }
    private val activity = mockk<Context>()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        prefs = SharedPreferencesManager(RuntimeEnvironment.getApplication())
        prefs.clear()
        owner = LocalDataOwner(prefs)
        authRepository = mockk(relaxed = true)
        every { authRepository.getCurrentUser() } returns null
        reset = mockk()
        coEvery { reset.wipeLocalData() } returns Unit
        google = FakeGoogleSignIn()
        online.value = true
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun user(uid: String, email: String?) = mockk<FirebaseUser>().also {
        every { it.uid } returns uid
        every { it.email } returns email
    }

    private fun result(user: FirebaseUser) = mockk<AuthResult>().also { every { it.user } returns user }

    private fun viewModel() = AuthViewModel(authRepository, owner, PushThenWipe(reset), google, network)

    /** One way a Google sign-in fails, and the state it gives online and offline. */
    private class Case(
        val name: String,
        val failure: Throwable,
        val inFirebase: Boolean,
        val online: AuthUiState,
        val offline: AuthUiState,
    )

    @Test
    fun eachFailure_givesItsState_onlineAndOffline() = runTest(dispatcher) {
        val failed = AuthUiState.Error(ErrorMessage.GOOGLE_FAILED)
        val failedFor = AuthUiState.Error(ErrorMessage.GOOGLE_FAILED, account = FakeGoogleSignIn.EMAIL)
        val offline = AuthUiState.Error(ErrorMessage.GOOGLE_OFFLINE)
        val cases = listOf(
            Case("cancel", GetCredentialCancellationException(RAW), false, AuthUiState.SignedOut, AuthUiState.SignedOut),
            Case("reauth", GetCredentialCancellationException("[16] Account reauth failed."), false, failed, offline),
            Case("no account", NoCredentialException(RAW), false, AuthUiState.NoGoogleAccount, offline),
            Case("interrupted", GetCredentialInterruptedException(RAW), false, failed, offline),
            Case("unknown", GetCredentialUnknownException(RAW), false, failed, offline),
            Case("configuration", GetCredentialProviderConfigurationException(RAW), false, failed, offline),
            Case("unsupported", GetCredentialUnsupportedException(RAW), false, failed, offline),
            Case("network", FirebaseNetworkException(RAW), true, offline, offline),
            Case("timeout", TimeoutException(RAW), true, offline, offline),
            Case(
                "collision",
                FirebaseAuthUserCollisionException("ERROR_CREDENTIAL_ALREADY_IN_USE", RAW),
                true,
                failedFor,
                failedFor,
            ),
        )
        for (case in cases) {
            for (isOnline in listOf(true, false)) {
                online.value = isOnline
                google.failure = if (case.inFirebase) null else case.failure
                if (case.inFirebase) {
                    coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } throws case.failure
                }
                val vm = viewModel()

                vm.signInWithGoogle(activity)
                advanceUntilIdle()

                val state = vm.state.value
                assertEquals("${case.name}, online $isOnline", if (isOnline) case.online else case.offline, state)
                if (state is AuthUiState.Error) {
                    assertFalse(signInText(state.message, state.account).contains(RAW))
                }
            }
        }
    }

    @Test
    fun aCancelInThePicker_keepsTheStateBefore() = runTest(dispatcher) {
        val vm = viewModel()
        google.failure = GetCredentialUnknownException(RAW)
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        val error = vm.state.value
        assertEquals(AuthUiState.Error(ErrorMessage.GOOGLE_FAILED), error)

        google.failure = GetCredentialCancellationException(RAW)
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        assertEquals(error, vm.state.value)

        google.failure = NoCredentialException(RAW)
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        google.failure = GetCredentialCancellationException(RAW)
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        assertEquals(AuthUiState.NoGoogleAccount, vm.state.value)
    }

    @Test
    fun aSuccess_signsInToFirebaseOnceWithTheToken() = runTest(dispatcher) {
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("a", FakeGoogleSignIn.EMAIL))
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) }
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        assertEquals("a", owner.uid())
        assertEquals(FakeGoogleSignIn.EMAIL, owner.label())
    }

    @Test
    fun aSecondTap_whileOneRuns_doesNothing() = runTest(dispatcher) {
        google.picker = CompletableDeferred()
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        runCurrent()
        vm.signInWithGoogle(activity)
        vm.signInAnonymously()
        runCurrent()

        assertEquals(1, google.accountCalls)
        coVerify(exactly = 0) { authRepository.signInAnonymously() }
        assertEquals(AuthUiState.Loading(), vm.state.value)
    }

    @Test
    fun cancel_whileThePickerIsOpen_closesItAndSignsOut() = runTest(dispatcher) {
        google.picker = CompletableDeferred()
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        runCurrent()

        vm.cancelSignIn()

        assertEquals(AuthUiState.SignedOut, vm.state.value)
        advanceUntilIdle()
        assertEquals(1, google.pickerCancels)
        coVerify(exactly = 0) { authRepository.signInWithGoogle(any()) }
        verify(exactly = 0) { authRepository.signOut() }
    }

    @Test
    fun cancel_duringTheFirebaseCall_signsTheLateAccountOut() = runTest(dispatcher) {
        val firebase = CompletableDeferred<AuthResult>()
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } coAnswers { firebase.await() }
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        runCurrent()
        assertEquals(AuthUiState.Loading(canCancel = true), vm.state.value)

        vm.cancelSignIn()
        assertEquals(AuthUiState.SignedOut, vm.state.value)
        firebase.complete(result(user("a", FakeGoogleSignIn.EMAIL)))
        advanceUntilIdle()

        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(AuthUiState.SignedOut, vm.state.value)
        assertNull(owner.uid())
    }

    @Test
    fun cancel_thenAFirebaseFailure_saysNothing() = runTest(dispatcher) {
        val firebase = CompletableDeferred<AuthResult>()
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } coAnswers { firebase.await() }
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        runCurrent()

        vm.cancelSignIn()
        firebase.completeExceptionally(FirebaseNetworkException(RAW))
        advanceUntilIdle()

        assertEquals(AuthUiState.SignedOut, vm.state.value)
        verify(exactly = 0) { authRepository.signOut() }
    }

    @Test
    fun aCancelledGuest_isSignedOutWhenFirebaseAnswers() = runTest(dispatcher) {
        val firebase = CompletableDeferred<AuthResult>()
        coEvery { authRepository.signInAnonymously() } coAnswers { firebase.await() }
        val vm = viewModel()
        vm.signInAnonymously()
        runCurrent()

        vm.cancelSignIn()
        firebase.complete(result(user("g", null)))
        advanceUntilIdle()

        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(AuthUiState.SignedOut, vm.state.value)
    }

    @Test
    fun aNewAttempt_waitsForTheCancelledOne_andItsAccountStays() = runTest(dispatcher) {
        val firebase = CompletableDeferred<AuthResult>()
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } coAnswers { firebase.await() }
        coEvery { authRepository.signInAnonymously() } returns result(user("b", null))
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        runCurrent()
        vm.cancelSignIn()

        vm.signInAnonymously()
        runCurrent()
        coVerify(exactly = 0) { authRepository.signInAnonymously() }

        firebase.complete(result(user("a", FakeGoogleSignIn.EMAIL)))
        advanceUntilIdle()

        coVerifyOrder {
            authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN)
            authRepository.signOut()
            authRepository.signInAnonymously()
        }
        verify(exactly = 1) { authRepository.signOut() }
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        assertEquals("b", owner.uid())
    }

    @Test
    fun cancel_duringTheHandOver_doesNothing() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { reset.pendingChangeCount() } returns 3
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("b", "b@example.com"))
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        assertEquals(AuthUiState.Loading(canCancel = false), vm.state.value)

        vm.cancelSignIn()
        advanceUntilIdle()

        assertEquals(AuthUiState.Loading(canCancel = false), vm.state.value)
        verify(exactly = 0) { authRepository.signOut() }
    }

    @Test
    fun clearingTheViewModel_signsNobodyOut() = runTest(dispatcher) {
        val firebase = CompletableDeferred<AuthResult>()
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } coAnswers { firebase.await() }
        val store = ViewModelStore()
        val vm = ViewModelProvider(
            store,
            object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>): T = modelClass.cast(viewModel())!!
            },
        )[AuthViewModel::class.java]
        vm.signInWithGoogle(activity)
        runCurrent()

        store.clear()
        firebase.complete(result(user("a", FakeGoogleSignIn.EMAIL)))
        advanceUntilIdle()

        verify(exactly = 0) { authRepository.signOut() }
    }

    @Test
    fun aFailureInTheHandOver_saysSignInFailed() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { reset.pendingChangeCount() } throws IllegalStateException(RAW)
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("b", "b@example.com"))
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()

        assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_FAILED), vm.state.value)
        assertEquals("a", owner.uid())
    }

    @Test
    fun accountSettingsClosed_offersGoogleAgain() = runTest(dispatcher) {
        google.failure = NoCredentialException(RAW)
        val vm = viewModel()
        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        assertEquals(AuthUiState.NoGoogleAccount, vm.state.value)

        vm.accountSettingsClosed()

        assertEquals(AuthUiState.SignedOut, vm.state.value)
    }

    /** People signed in before the update stay signed in: startup signs nobody out. */
    @Test
    fun start_withAStoredSession_staysSignedIn_andSignsNobodyOut() = runTest(dispatcher) {
        val sessions = listOf(
            Triple("Google user, same owner", user("a", "a@example.com"), "a"),
            Triple("Google user, no owner", user("a", "a@example.com"), null),
            Triple("guest, same owner", user("g", null), "g"),
            Triple("guest, no owner", user("g", null), null),
        )
        for ((name, stored, ownerUid) in sessions) {
            prefs.clear()
            if (ownerUid != null) owner.adopt(ownerUid, stored.email)
            every { authRepository.getCurrentUser() } returns stored

            val vm = viewModel()
            advanceUntilIdle()

            assertEquals(name, AuthUiState.SignedIn(stored), vm.state.value)
        }
        verify(exactly = 0) { authRepository.signOut() }
        assertEquals(0, google.forgetCalls)
        assertEquals(0, google.accountCalls)
    }

    private companion object {
        const val RAW = "raw text of the exception"
    }
}
