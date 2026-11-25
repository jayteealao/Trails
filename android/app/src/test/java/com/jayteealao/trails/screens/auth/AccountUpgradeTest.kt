package com.jayteealao.trails.screens.auth

import android.app.Application
import android.content.Context
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.NoCredentialException
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
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The account upgrade from Settings links the Google account to the guest: the uid and the
 * library stay, the sign-in state never leaves SignedIn, and a failure keeps the guest with
 * its own words.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class AccountUpgradeTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var authRepository: AuthRepository
    private lateinit var owner: LocalDataOwner
    private lateinit var reset: LocalDataReset
    private lateinit var google: FakeGoogleSignIn
    private val online = MutableStateFlow(true)
    private val network = mockk<NetworkMonitor> { every { isOnline } returns online }
    private val activity = mockk<Context>()
    private val guest = user(GUEST, null)

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        val prefs = SharedPreferencesManager(RuntimeEnvironment.getApplication())
        prefs.clear()
        owner = LocalDataOwner(prefs)
        owner.adopt(GUEST, null)
        authRepository = mockk(relaxed = true)
        every { authRepository.getCurrentUser() } returns guest
        coEvery { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) } returns result(user(GUEST, FakeGoogleSignIn.EMAIL))
        reset = mockk(relaxed = true)
        google = FakeGoogleSignIn()
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

    /** Every state and event of [vm] from now on. */
    private fun TestScope.record(vm: AuthViewModel): Pair<List<AuthUiState>, List<AuthEvent>> {
        val states = mutableListOf<AuthUiState>()
        val events = mutableListOf<AuthEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.state.collect { states += it } }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.event.collect { events += it } }
        return states to events
    }

    @Test
    fun theUpgrade_linksAndNeverSignsIn_andStaysSignedInThroughout() = runTest(dispatcher) {
        val vm = viewModel()
        val (states, events) = record(vm)

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) }
        coVerify(exactly = 0) { authRepository.signInWithGoogle(any()) }
        assertTrue(states.all { it is AuthUiState.SignedIn })
        assertEquals(GUEST, owner.uid())
        assertEquals(FakeGoogleSignIn.EMAIL, owner.label())
        coVerify(exactly = 0) { reset.wipeLocalData() }
        assertEquals(UpgradeState.Done, vm.upgrade.value)
        assertEquals(listOf<AuthEvent>(AuthEvent.Upgraded), events)
    }

    @Test
    fun aLinkedUserWithNoEmail_takesTheGoogleAddress() = runTest(dispatcher) {
        coEvery { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) } returns result(user(GUEST, null))
        val vm = viewModel()

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        assertEquals(FakeGoogleSignIn.EMAIL, owner.label())
    }

    @Test
    fun eachFailure_keepsTheGuest_withItsMessage() = runTest(dispatcher) {
        val cases = listOf(
            Triple(NoCredentialException(RAW), false, ErrorMessage.GOOGLE_NO_ACCOUNT),
            Triple(GetCredentialInterruptedException(RAW), false, ErrorMessage.UPGRADE_FAILED),
            Triple(GetCredentialCancellationException("[16] Account reauth failed."), false, ErrorMessage.UPGRADE_FAILED),
            Triple(FirebaseNetworkException(RAW), true, ErrorMessage.GOOGLE_OFFLINE),
            Triple(
                FirebaseAuthUserCollisionException("ERROR_CREDENTIAL_ALREADY_IN_USE", RAW),
                true,
                ErrorMessage.ACCOUNT_IN_USE,
            ),
            Triple(IllegalStateException(RAW), true, ErrorMessage.UPGRADE_FAILED),
        )
        for ((failure, inFirebase, message) in cases) {
            google.failure = if (inFirebase) null else failure
            if (inFirebase) coEvery { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) } throws failure
            val vm = viewModel()
            val (states, events) = record(vm)

            vm.upgradeAccount(activity)
            advanceUntilIdle()

            assertTrue("$failure", states.all { it == AuthUiState.SignedIn(guest) })
            assertEquals("$failure", UpgradeState.Idle, vm.upgrade.value)
            assertEquals("$failure", listOf<AuthEvent>(AuthEvent.UpgradeFailed(message)), events)
            assertEquals(GUEST, owner.uid())
        }
        coVerify(exactly = 0) { authRepository.signInWithGoogle(any()) }
        verify(exactly = 0) { authRepository.signOut() }
    }

    @Test
    fun aCredentialFailureOffline_saysOffline() = runTest(dispatcher) {
        online.value = false
        google.failure = GetCredentialInterruptedException(RAW)
        val vm = viewModel()
        val (_, events) = record(vm)

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        assertEquals(listOf<AuthEvent>(AuthEvent.UpgradeFailed(ErrorMessage.GOOGLE_OFFLINE)), events)
    }

    @Test
    fun aCancel_saysNothing() = runTest(dispatcher) {
        google.failure = GetCredentialCancellationException(RAW)
        val vm = viewModel()
        val (_, events) = record(vm)

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        assertTrue(events.isEmpty())
        assertEquals(UpgradeState.Idle, vm.upgrade.value)
        assertEquals(AuthUiState.SignedIn(guest), vm.state.value)
    }

    @Test
    fun aSecondTap_whileOneRuns_isIgnored() = runTest(dispatcher) {
        google.picker = CompletableDeferred()
        val vm = viewModel()

        vm.upgradeAccount(activity)
        runCurrent()
        vm.upgradeAccount(activity)
        runCurrent()

        assertEquals(1, google.accountCalls)
        assertEquals(UpgradeState.Running, vm.upgrade.value)
    }

    @Test
    fun noUpgrade_whenNobodyIsSignedIn() = runTest(dispatcher) {
        every { authRepository.getCurrentUser() } returns null
        val vm = viewModel()

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        assertEquals(0, google.accountCalls)
        assertEquals(UpgradeState.Idle, vm.upgrade.value)
    }

    @Test
    fun logout_stopsARunningUpgrade_whichCannotSignInLater() = runTest(dispatcher) {
        val link = CompletableDeferred<AuthResult>()
        coEvery { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) } coAnswers { link.await() }
        val vm = viewModel()
        val (_, events) = record(vm)
        vm.upgradeAccount(activity)
        runCurrent()

        vm.signOut()
        link.complete(result(user(GUEST, FakeGoogleSignIn.EMAIL)))
        advanceUntilIdle()

        assertEquals(AuthUiState.SignedOut, vm.state.value)
        assertEquals(UpgradeState.Idle, vm.upgrade.value)
        assertEquals(null, owner.label())
        assertTrue(events.none { it == AuthEvent.Upgraded })
    }

    @Test
    fun signOut_tellsTheProviders_andAFailureThereStillSignsOut() = runTest(dispatcher) {
        google.forgetFailure = IllegalStateException(RAW)
        val vm = viewModel()

        vm.signOut()
        advanceUntilIdle()

        assertEquals(1, google.forgetCalls)
        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(AuthUiState.SignedOut, vm.state.value)
    }

    private companion object {
        const val GUEST = "guest-uid"
        const val RAW = "raw text of the exception"
    }
}
