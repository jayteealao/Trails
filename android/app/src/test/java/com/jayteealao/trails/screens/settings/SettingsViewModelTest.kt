package com.jayteealao.trails.screens.settings

import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.LocalDataReset
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncStatus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

/**
 * Settings logout, "Clear data" and the sync-failure Retry, over the real push-then-wipe
 * sequence with the device operations mocked: "Logout only" clears nothing; "Clear data"
 * asks when a push fails, keeps everything on "Keep data", and clears, forgets preferences
 * and signs out in that order on "Clear anyway".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var articleDao: ArticleDao
    private lateinit var prefs: SharedPreferencesManager
    private lateinit var syncManager: FirestoreSyncManager
    private lateinit var authRepository: AuthRepository
    private lateinit var reset: LocalDataReset
    private lateinit var owner: LocalDataOwner
    private val failureCount = MutableStateFlow(0)
    private val user = mockk<FirebaseUser>().also {
        every { it.uid } returns "owner-a"
        every { it.email } returns "a@example.com"
        every { it.isAnonymous } returns false
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        articleDao = mockk()
        every { articleDao.observeSyncFailureCount() } returns failureCount
        prefs = mockk(relaxed = true)
        every { prefs.booleanFlow(any(), any()) } returns flowOf(false)
        every { prefs.getBoolean(any(), any()) } returns false
        syncManager = mockk()
        every { syncManager.isSyncing } returns MutableStateFlow(false)
        every { syncManager.lastSyncTime } returns MutableStateFlow(0L)
        every { syncManager.syncStatus } returns MutableStateFlow<SyncStatus>(SyncStatus.Idle)
        every { syncManager.lastError } returns MutableStateFlow<String?>(null)
        authRepository = mockk(relaxed = true)
        every { authRepository.getCurrentUser() } returns user
        reset = mockk()
        coEvery { reset.wipeLocalData() } returns Unit
        owner = mockk()
        every { owner.label() } returns "a@example.com"
        every { owner.isOwnedBy("owner-a") } returns true
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = SettingsViewModel(
        articleDao = articleDao,
        sharedPreferencesManager = prefs,
        firestoreSyncManager = syncManager,
        authRepository = authRepository,
        ioDispatcher = dispatcher,
        pushThenWipe = PushThenWipe(reset),
        localDataOwner = owner,
    )

    /** Subscribes to state and events for the rest of the test; returns the event list. */
    private fun TestScope.observe(vm: SettingsViewModel): MutableList<SettingsEvent> {
        val events = mutableListOf<SettingsEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.state.collect {} }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.event.collect { events += it } }
        runCurrent()
        return events
    }

    private fun dialog(vm: SettingsViewModel) = vm.state.value.unsyncedChangesDialog

    @Test
    fun logoutOnly_signsOutAndClearsNothing() = runTest(dispatcher) {
        val vm = viewModel()
        val events = observe(vm)

        vm.logout(clearData = false)
        advanceUntilIdle()

        verify(exactly = 1) { authRepository.signOut() }
        assertEquals(listOf<SettingsEvent>(SettingsEvent.LoggedOut), events)
        coVerify(exactly = 0) { reset.pendingChangeCount() }
        coVerify(exactly = 0) { reset.wipeLocalData() }
        verify(exactly = 0) { prefs.clear() }
        verify(exactly = 0) { owner.clear() }
        verify(exactly = 0) { owner.adopt(any(), any()) }
    }

    @Test
    fun clearData_failedPush_asks_andKeepDataChangesNothing() = runTest(dispatcher) {
        coEvery { reset.pendingChangeCount() } returns 2
        coEvery { reset.pushPendingChanges() } returns false
        val vm = viewModel()
        val events = observe(vm)

        vm.logout(clearData = true)
        advanceUntilIdle()

        assertEquals(UnsyncedChangesDialogState.PushFailed(2, WipeReason.CLEAR_DATA, "a@example.com"), dialog(vm))
        coVerify(exactly = 0) { reset.wipeLocalData() }

        vm.keepLocalData()
        advanceUntilIdle()

        assertEquals(UnsyncedChangesDialogState.Hidden, dialog(vm))
        coVerify(exactly = 0) { reset.wipeLocalData() }
        verify(exactly = 0) { authRepository.signOut() }
        verify(exactly = 0) { prefs.clear() }
        assertTrue(events.none { it == SettingsEvent.LoggedOut })
    }

    @Test
    fun clearData_failedPush_clearAnyway_wipesThenForgetsThenSignsOut() = runTest(dispatcher) {
        coEvery { reset.pendingChangeCount() } returns 2
        coEvery { reset.pushPendingChanges() } returns false
        val vm = viewModel()
        val events = observe(vm)

        vm.logout(clearData = true)
        advanceUntilIdle()
        vm.clearAnyway()
        advanceUntilIdle()

        coVerifyOrder {
            reset.wipeLocalData()
            prefs.clear()
            authRepository.signOut()
        }
        assertEquals(listOf<SettingsEvent>(SettingsEvent.LoggedOut), events)
        assertEquals(UnsyncedChangesDialogState.Hidden, dialog(vm))
    }

    @Test
    fun clearData_pushOver15Seconds_asks() = runTest(dispatcher) {
        coEvery { reset.pendingChangeCount() } returns 4
        coEvery { reset.pushPendingChanges() } coAnswers {
            delay(20.seconds)
            true
        }
        val vm = viewModel()
        observe(vm)

        vm.logout(clearData = true)
        advanceUntilIdle()

        assertEquals(15_000L, currentTime)
        assertEquals(UnsyncedChangesDialogState.PushFailed(4, WipeReason.CLEAR_DATA, "a@example.com"), dialog(vm))
        coVerify(exactly = 0) { reset.wipeLocalData() }
    }

    @Test
    fun clearData_cancelWhilePushing_hidesAndWipesNothing() = runTest(dispatcher) {
        coEvery { reset.pendingChangeCount() } returns 4
        coEvery { reset.pushPendingChanges() } coAnswers {
            delay(10.seconds)
            true
        }
        val vm = viewModel()
        val events = observe(vm)

        vm.logout(clearData = true)
        runCurrent()
        assertEquals(UnsyncedChangesDialogState.Pushing(4), dialog(vm))

        vm.cancelUnsyncedPush()
        advanceUntilIdle()

        assertEquals(UnsyncedChangesDialogState.Hidden, dialog(vm))
        coVerify(exactly = 0) { reset.wipeLocalData() }
        verify(exactly = 0) { authRepository.signOut() }
        assertTrue(events.isEmpty())
    }

    @Test
    fun clearData_signedOutUser_doesNotPush() = runTest(dispatcher) {
        every { authRepository.getCurrentUser() } returns null
        coEvery { reset.pendingChangeCount() } returns 1
        val vm = viewModel()
        observe(vm)

        vm.logout(clearData = true)
        advanceUntilIdle()

        assertEquals(UnsyncedChangesDialogState.PushFailed(1, WipeReason.CLEAR_DATA, "a@example.com"), dialog(vm))
        coVerify(exactly = 0) { reset.pushPendingChanges() }
    }

    @Test
    fun failureCount_reachesState() = runTest(dispatcher) {
        failureCount.value = 2
        val vm = viewModel()
        observe(vm)

        assertEquals(2, vm.state.value.syncFailureCount)
        assertFalse(vm.state.value.isRetryingFailures)
    }

    @Test
    fun retry_resetsThenPushes_showingProgressWhileItRuns() = runTest(dispatcher) {
        failureCount.value = 2
        coEvery { articleDao.resetSyncFailures(any()) } answers {
            failureCount.value = 0
            2
        }
        val gate = CompletableDeferred<Unit>()
        coEvery { syncManager.pushLocalChanges() } coAnswers {
            gate.await()
            SyncRunResult(2, 0)
        }
        val vm = viewModel()
        val events = observe(vm)

        vm.retrySyncFailures()
        runCurrent()

        assertTrue(vm.state.value.isRetryingFailures)
        assertEquals(2, vm.state.value.syncFailureCount)

        gate.complete(Unit)
        advanceUntilIdle()

        assertFalse(vm.state.value.isRetryingFailures)
        assertEquals(0, vm.state.value.syncFailureCount)
        coVerifyOrder {
            articleDao.resetSyncFailures(any())
            syncManager.pushLocalChanges()
        }
        assertTrue(events.isEmpty())
    }

    @Test
    fun retry_failedPush_showsToast() = runTest(dispatcher) {
        failureCount.value = 2
        coEvery { articleDao.resetSyncFailures(any()) } returns 2
        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(0, 2)
        val vm = viewModel()
        val events = observe(vm)

        vm.retrySyncFailures()
        advanceUntilIdle()

        assertEquals(1, events.size)
        assertTrue(events.single() is SettingsEvent.ShowToast)
        assertFalse(vm.state.value.isRetryingFailures)
    }

    @Test
    fun manualSync_isIgnoredWhileTheDialogShows() = runTest(dispatcher) {
        coEvery { reset.pendingChangeCount() } returns 2
        coEvery { reset.pushPendingChanges() } returns false
        coEvery { syncManager.performFullSync() } returns Unit
        val vm = viewModel()
        observe(vm)
        vm.logout(clearData = true)
        advanceUntilIdle()

        vm.performManualSync()
        advanceUntilIdle()

        coVerify(exactly = 0) { syncManager.performFullSync() }
    }
}
