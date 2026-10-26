package com.jayteealao.trails.screens.auth

import android.app.Application
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseUser
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
    private val credential = mockk<AuthCredential>()

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

    private fun viewModel() = AuthViewModel(authRepository, owner, PushThenWipe(reset))

    @Test
    fun firstSignIn_adoptsTheLibrary() = runTest(dispatcher) {
        val a = user("a", "a@example.com")
        coEvery { authRepository.signInWithCredential(credential) } returns result(a)
        val vm = viewModel()

        vm.signInWithCredential(credential)
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
        coEvery { authRepository.signInWithCredential(credential) } returns result(user("a", "a@example.com"))
        val vm = viewModel()

        vm.signInWithCredential(credential)
        advanceUntilIdle()

        assertTrue(vm.state.value is AuthUiState.SignedIn)
        coVerify(exactly = 0) { reset.pendingChangeCount() }
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun guestLinkedToGoogle_keepsTheLibraryAndTakesTheEmail() = runTest(dispatcher) {
        owner.adopt("a", null)
        coEvery { authRepository.linkWithCredential(credential) } returns result(user("a", "a@example.com"))
        val vm = viewModel()

        vm.linkWithCredential(credential)
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
        assertEquals(AuthUiState.Loading, stateAtWipe)
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
        coEvery { authRepository.signInWithCredential(credential) } returns result(user("b", "b@example.com"))
        val vm = viewModel()

        vm.signInWithCredential(credential)
        advanceUntilIdle()

        assertEquals(
            UnsyncedChangesDialogState.PushFailed(3, WipeReason.ACCOUNT_SWITCH, "a@example.com"),
            vm.unsyncedChangesDialog.value,
        )
        assertEquals(AuthUiState.Loading, vm.state.value)
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
        coEvery { authRepository.signInWithCredential(credential) } returns result(user("b", "b@example.com"))
        val vm = viewModel()

        vm.signInWithCredential(credential)
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
