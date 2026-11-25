package com.jayteealao.trails.screens.auth

import android.app.Application
import android.content.Context
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.LocalDataReset
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Sign-in and the owner of the local library: the first account adopts it, the same uid
 * (a link included) keeps it, and another account gets it only after the device is
 * cleared; with changes not backed up the person decides, and keeping them signs the new
 * account out. Nothing is ever pushed as the new account.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class AuthViewModelOwnerTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var authRepository: AuthRepository
    private lateinit var owner: LocalDataOwner
    private lateinit var reset: LocalDataReset
    private val google = FakeGoogleSignIn()
    private val activity = mockk<Context>()
    private val network = mockk<NetworkMonitor> { every { isOnline } returns flowOf(true) }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        val prefs = SharedPreferencesManager(RuntimeEnvironment.getApplication())
        prefs.clear()
        owner = LocalDataOwner(prefs)
        authRepository = mockk(relaxed = true)
        every { authRepository.getCurrentUser() } returns null
        reset = mockk()
        coEvery { reset.wipeLocalData() } returns Unit
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

    @Test
    fun firstSignIn_adoptsTheLibrary() = runTest(dispatcher) {
        val a = user("a", "a@example.com")
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(a)
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()

        assertEquals("a", owner.uid())
        assertEquals("a@example.com", owner.label())
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        coVerify(exactly = 0) { reset.pendingChangeCount() }
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun sameAccount_keepsTheLibrary() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("a", "a@example.com"))
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()

        assertTrue(vm.state.value is AuthUiState.SignedIn)
        coVerify(exactly = 0) { reset.pendingChangeCount() }
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun guestLinkedToGoogle_keepsTheLibraryAndTakesTheEmail() = runTest(dispatcher) {
        owner.adopt("a", null)
        // The guest is signed in when the upgrade starts.
        every { authRepository.getCurrentUser() } returns user("a", null)
        coEvery { authRepository.linkGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("a", "a@example.com"))
        val vm = viewModel()

        vm.upgradeAccount(activity)
        advanceUntilIdle()

        assertTrue(vm.state.value is AuthUiState.SignedIn)
        assertEquals("a", owner.uid())
        assertEquals("a@example.com", owner.label())
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun otherAccount_nothingPending_clearsBeforeHandingOver() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { reset.pendingChangeCount() } returns 0
        val vm = viewModel()
        var ownerAtWipe: String? = null
        var stateAtWipe: AuthUiState? = null
        coEvery { reset.wipeLocalData() } answers {
            ownerAtWipe = owner.uid()
            stateAtWipe = vm.state.value
        }
        coEvery { authRepository.signInAnonymously() } returns result(user("b", null))

        vm.signInAnonymously()
        advanceUntilIdle()

        assertEquals("a", ownerAtWipe)
        assertEquals(AuthUiState.Loading(canCancel = false), stateAtWipe)
        assertEquals("b", owner.uid())
        assertNull(owner.label())
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        coVerify(exactly = 1) { reset.wipeLocalData() }
        coVerify(exactly = 0) { reset.pushPendingChanges() }
    }

    @Test
    fun otherAccount_changesPending_asks_andKeepingSignsTheNewAccountOut() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { reset.pendingChangeCount() } returns 3
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("b", "b@example.com"))
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()

        assertEquals(
            UnsyncedChangesDialogState.PushFailed(3, WipeReason.ACCOUNT_SWITCH, "a@example.com"),
            vm.unsyncedChangesDialog.value,
        )
        assertEquals(AuthUiState.Loading(canCancel = false), vm.state.value)
        coVerify(exactly = 0) { reset.wipeLocalData() }

        vm.keepPreviousAccountData()
        advanceUntilIdle()

        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(AuthUiState.SignedOut, vm.state.value)
        assertEquals(UnsyncedChangesDialogState.Hidden, vm.unsyncedChangesDialog.value)
        assertEquals("a", owner.uid())
        coVerify(exactly = 0) { reset.wipeLocalData() }
        coVerify(exactly = 0) { reset.pushPendingChanges() }
    }

    @Test
    fun otherAccount_changesPending_switchAnywayClearsAndAdopts() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        coEvery { reset.pendingChangeCount() } returns 3
        coEvery { authRepository.signInWithGoogle(FakeGoogleSignIn.TOKEN) } returns result(user("b", "b@example.com"))
        val vm = viewModel()

        vm.signInWithGoogle(activity)
        advanceUntilIdle()
        vm.switchAccountAnyway()
        advanceUntilIdle()

        coVerify(exactly = 1) { reset.wipeLocalData() }
        assertEquals("b", owner.uid())
        assertEquals("b@example.com", owner.label())
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        coVerify(exactly = 0) { reset.pushPendingChanges() }
    }

    @Test
    fun start_withAnotherAccountSignedIn_signsItOut() = runTest(dispatcher) {
        owner.adopt("a", "a@example.com")
        every { authRepository.getCurrentUser() } returns user("b", "b@example.com")

        val vm = viewModel()

        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(AuthUiState.SignedOut, vm.state.value)
        assertEquals("a", owner.uid())
    }

    @Test
    fun start_withNoOwner_adoptsTheSignedInAccount() = runTest(dispatcher) {
        every { authRepository.getCurrentUser() } returns user("a", "a@example.com")

        val vm = viewModel()

        assertEquals("a", owner.uid())
        assertTrue(vm.state.value is AuthUiState.SignedIn)
        verify(exactly = 0) { authRepository.signOut() }
    }
}
