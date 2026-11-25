package com.jayteealao.trails.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A [LibraryStatus] whose state the test sets, and which counts the calls. */
internal class FakeLibraryStatus(initial: LibraryState = LibraryState()) : LibraryStatus {
    override val state = MutableStateFlow(initial)
    var restores = 0
    var retries = 0

    override fun restoreIfEmpty() {
        restores++
    }

    override fun retry() {
        retries++
    }
}

/** When the library restores itself, and what it says while and after. */
@OptIn(ExperimentalCoroutinesApi::class)
class LibraryStatusTest {

    private val dispatcher = StandardTestDispatcher()
    private val job: Job = SupervisorJob()

    private val dao = mockk<ArticleDao>()
    private val auth = mockk<FirebaseAuth>()
    private val syncManager = mockk<FirestoreSyncManager>()
    private val backupService = mockk<FirestoreBackupService>()
    private val networkMonitor = mockk<NetworkMonitor>()

    private val hasArticles = MutableStateFlow(false)
    private val syncing = MutableStateFlow(false)
    private val online = MutableStateFlow(true)
    private val listeners = mutableListOf<FirebaseAuth.AuthStateListener>()
    private var user: FirebaseUser? = null

    private fun account(uid: String, email: String? = null): FirebaseUser = mockk {
        every { this@mockk.uid } returns uid
        every { this@mockk.email } returns email
    }

    private fun signIn(next: FirebaseUser?) {
        user = next
        listeners.toList().forEach { it.onAuthStateChanged(auth) }
    }

    private fun status(): DefaultLibraryStatus {
        every { auth.currentUser } answers { user }
        every { auth.addAuthStateListener(any()) } answers { listeners += firstArg<FirebaseAuth.AuthStateListener>() }
        every { auth.removeAuthStateListener(any()) } answers {
            listeners -= firstArg<FirebaseAuth.AuthStateListener>()
        }
        every { dao.observeHasArticles() } returns hasArticles
        coEvery { dao.countAllArticles() } answers { if (hasArticles.value) 1 else 0 }
        every { syncManager.isSyncing } returns syncing
        every { networkMonitor.isOnline } returns online
        return DefaultLibraryStatus(
            dao, auth, syncManager, backupService, networkMonitor, CoroutineScope(dispatcher + job),
        )
    }

    private fun test(block: suspend TestScope.() -> Unit) = runTest(dispatcher) {
        try {
            block()
        } finally {
            job.cancel()
        }
    }

    private suspend fun TestScope.settled(status: LibraryStatus): LibraryState {
        advanceUntilIdle()
        return status.state.first { it.hasArticles != null }
    }

    private fun syncRuns(result: SyncRunResult) = coEvery { syncManager.fullSync() } returns result

    private val success = SyncRunResult(pushed = 0, failed = 0)
    private val failure = SyncRunResult(pushed = 0, failed = 0, interruptedBy = IllegalStateException("raw text"))

    @Test
    fun notSignedIn_neverRestores() = test {
        val status = status()

        status.restoreIfEmpty()
        status.retry()

        assertEquals(LibraryState(hasArticles = false), settled(status))
        coVerify(exactly = 0) { syncManager.fullSync() }
    }

    @Test
    fun aGuestCountsAsSignedIn_andHasNoEmail() = test {
        user = account("guest", email = "")
        val state = settled(status())

        assertTrue(state.signedIn)
        assertEquals(null, state.email)
    }

    @Test
    fun anEmptyPhone_restoresOncePerUser() = test {
        syncRuns(success)
        user = account("a", "a@example.com")
        val status = status()

        status.restoreIfEmpty()
        status.restoreIfEmpty()
        assertEquals(LibraryLoad.Idle, settled(status).load)
        status.restoreIfEmpty()
        advanceUntilIdle()

        coVerify(exactly = 1) { syncManager.fullSync() }
    }

    @Test
    fun aPhoneWithArticles_doesNotRestore() = test {
        hasArticles.value = true
        user = account("a")
        val status = status()

        status.restoreIfEmpty()

        assertEquals(LibraryState(hasArticles = true, signedIn = true), settled(status))
        coVerify(exactly = 0) { syncManager.fullSync() }
    }

    @Test
    fun whileTheRestoreRuns_itIsLoading_andARetryStartsNoSecondOne() = test {
        val answer = CompletableDeferred<SyncRunResult>()
        coEvery { syncManager.fullSync() } coAnswers { answer.await() }
        user = account("a")
        val status = status()

        status.restoreIfEmpty()
        assertEquals(LibraryLoad.Loading, settled(status).load)
        status.retry()
        advanceUntilIdle()
        answer.complete(success)

        assertEquals(LibraryLoad.Idle, settled(status).load)
        coVerify(exactly = 1) { syncManager.fullSync() }
    }

    @Test
    fun aRunningSync_isLoading() = test {
        user = account("a")
        val status = status()
        syncing.value = true
        assertEquals(LibraryLoad.Loading, settled(status).load)

        syncing.value = false
        assertEquals(LibraryLoad.Idle, settled(status).load)
    }

    @Test
    fun offline_asksNothing_andARetryOnlineRestores() = test {
        syncRuns(success)
        online.value = false
        user = account("a")
        val status = status()

        status.restoreIfEmpty()
        assertEquals(LibraryLoad.Failed(offline = true, remoteCount = null), settled(status).load)
        coVerify(exactly = 0) { syncManager.fullSync() }

        online.value = true
        status.retry()
        assertEquals(LibraryLoad.Idle, settled(status).load)
        coVerify(exactly = 1) { syncManager.fullSync() }
    }

    @Test
    fun aFailedRestore_saysHowManyAreOnTheServer() = test {
        syncRuns(failure)
        coEvery { backupService.getRemoteArticleCount() } returns Result.success(1284)
        user = account("a", "a@example.com")
        val status = status()

        status.restoreIfEmpty()

        val state = settled(status)
        assertEquals(LibraryLoad.Failed(offline = false, remoteCount = 1284), state.load)
        assertEquals("a@example.com", state.email)
    }

    @Test
    fun aFailedRestore_withNoCount_inventsNone() = test {
        syncRuns(failure)
        coEvery { backupService.getRemoteArticleCount() } returns Result.failure(IllegalStateException("raw text"))
        user = account("a")
        val status = status()

        status.restoreIfEmpty()

        assertEquals(LibraryLoad.Failed(offline = false, remoteCount = null), settled(status).load)
    }

    @Test
    fun anExceptionFromTheSync_isAFailure() = test {
        coEvery { syncManager.fullSync() } throws IllegalStateException("raw text")
        user = account("a")
        val status = status()

        status.restoreIfEmpty()

        assertEquals(LibraryLoad.Failed(offline = false, remoteCount = null), settled(status).load)
    }

    @Test
    fun anotherAccount_dropsTheFailure_andRestoresOnItsOwn() = test {
        syncRuns(failure)
        coEvery { backupService.getRemoteArticleCount() } returns Result.success(3)
        user = account("a")
        val status = status()
        status.restoreIfEmpty()
        assertTrue(settled(status).load is LibraryLoad.Failed)

        syncRuns(success)
        signIn(account("b"))
        assertEquals(LibraryLoad.Idle, settled(status).load)
        status.restoreIfEmpty()
        advanceUntilIdle()

        coVerify(exactly = 2) { syncManager.fullSync() }
    }

    @Test
    fun theResultOfAnAccountThatLeft_isDropped() = test {
        val answer = CompletableDeferred<SyncRunResult>()
        coEvery { syncManager.fullSync() } coAnswers { answer.await() }
        coEvery { backupService.getRemoteArticleCount() } returns Result.success(3)
        user = account("a")
        val status = status()
        status.restoreIfEmpty()
        advanceUntilIdle()

        signIn(null)
        advanceUntilIdle()
        answer.complete(failure)
        advanceUntilIdle()
        signIn(account("a"))

        assertEquals(LibraryLoad.Idle, settled(status).load)
    }

    @Test
    fun cancellation_isNoFailure_andTheNextOpenRestores() = test {
        coEvery { syncManager.fullSync() } throws CancellationException("stopped")
        user = account("a")
        val status = status()
        status.restoreIfEmpty()
        assertEquals(LibraryLoad.Idle, settled(status).load)

        syncRuns(success)
        status.restoreIfEmpty()
        advanceUntilIdle()

        coVerify(exactly = 2) { syncManager.fullSync() }
        // Rethrown, so it ended its own coroutine and not the scope.
        assertFalse(job.isCancelled)
    }

    @Test
    fun aFailingRowCheck_stillGivesTheAccount() = test {
        user = account("a")
        val status = status()
        every { dao.observeHasArticles() } returns flow { throw IllegalStateException("raw text") }
        val broken = DefaultLibraryStatus(
            dao, auth, syncManager, backupService, networkMonitor, CoroutineScope(dispatcher + job),
        )
        advanceUntilIdle()

        assertEquals(LibraryState(hasArticles = null, signedIn = true), broken.state.first())
        assertTrue(settled(status).signedIn)
    }
}
