package com.jayteealao.trails.sync.workers

import android.app.Application
import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncTimeoutException
import com.jayteealao.trails.services.firestore.isTransientSyncFailure
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.IOException
import com.jayteealao.trails.testing.TestLocalDataOwner

/**
 * The sync and restore workers map each run outcome to the WorkManager result (retry on
 * any failure, success when everything was pushed or nobody is signed in); every sync
 * request uses exponential backoff and needs a connected network; a backup call that
 * never completes stops the run as a timeout; and the failure classifier tells transient
 * failures from an article's own.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class SyncWorkerResultTest {

    private lateinit var context: Context
    private lateinit var syncManager: FirestoreSyncManager

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        // The workers' foreground notification reads WorkManager for its cancel intent.
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build()
        )
        syncManager = mockk()
    }

    private suspend fun runSyncWorker(): ListenableWorker.Result {
        val worker = TestListenableWorkerBuilder<FirestoreSyncWorker>(context).build()
        worker.firestoreSyncManager = syncManager
        return worker.doWork()
    }

    private suspend fun runRestoreWorker(runAttemptCount: Int = 0): ListenableWorker.Result {
        val worker = TestListenableWorkerBuilder<FirestoreRestoreWorker>(context)
            .setRunAttemptCount(runAttemptCount)
            .build()
        worker.firestoreSyncManager = syncManager
        return worker.doWork()
    }

    // ---- Worker results ------------------------------------------------------

    @Test
    fun syncWorker_mapsEachOutcome() = runTest {
        for ((outcome, expected) in OUTCOMES) {
            coEvery { syncManager.pushLocalChanges() } returns outcome
            assertEquals("outcome ${outcome.status}", expected, runSyncWorker())
        }
    }

    @Test
    fun syncWorker_retriesWhenTheRunThrows() = runTest {
        coEvery { syncManager.pushLocalChanges() } throws IllegalStateException("boom")

        assertEquals(ListenableWorker.Result.retry(), runSyncWorker())
    }

    @Test
    fun restoreWorker_mapsEachOutcome() = runTest {
        for ((outcome, expected) in OUTCOMES) {
            coEvery { syncManager.fullSync() } returns outcome
            assertEquals("outcome ${outcome.status}", expected, runRestoreWorker())
        }
    }

    @Test
    fun restoreWorker_retriesWhenTheRunThrows() = runTest {
        coEvery { syncManager.fullSync() } throws IllegalStateException("boom")

        assertEquals(ListenableWorker.Result.retry(), runRestoreWorker())
    }

    @Test
    fun restoreWorker_givesUpOnItsLastAttempt() = runTest {
        val last = FirestoreRestoreWorker.MAX_RESTORE_ATTEMPTS - 1
        coEvery { syncManager.fullSync() } returns SyncRunResult(0, 2)
        assertEquals(ListenableWorker.Result.retry(), runRestoreWorker(runAttemptCount = last - 1))
        assertEquals(ListenableWorker.Result.failure(), runRestoreWorker(runAttemptCount = last))

        coEvery { syncManager.fullSync() } throws IllegalStateException("boom")
        assertEquals(ListenableWorker.Result.failure(), runRestoreWorker(runAttemptCount = last))

        // A clean run on the last attempt is still a success.
        coEvery { syncManager.fullSync() } returns SyncRunResult(3, 0)
        assertEquals(ListenableWorker.Result.success(), runRestoreWorker(runAttemptCount = last))
    }

    // ---- Requests ------------------------------------------------------------

    @Test
    fun everySyncRequest_hasExponentialBackoffAndNeedsNetwork() {
        val realManager = realManager(mockk(), mockk())
        val specs = mapOf(
            "sync" to FirestoreSyncWorker.startUpSyncWork().workSpec,
            "restore" to FirestoreRestoreWorker.startUpRestoreWork().workSpec,
            "periodic" to realManager.periodicSyncRequest().workSpec,
        )
        for ((name, spec) in specs) {
            assertEquals(name, BackoffPolicy.EXPONENTIAL, spec.backoffPolicy)
            assertEquals(name, NetworkType.CONNECTED, spec.constraints.requiredNetworkType)
        }
    }

    // ---- Timeout -------------------------------------------------------------

    @Test
    fun backupThatNeverCompletes_stopsTheRunAsTimeout() = runTest {
        val dao = mockk<ArticleDao>()
        val backup = mockk<FirestoreBackupService>()
        coEvery { backup.getUserMetaSnapshot() } returns
            Result.success(FirestoreBackupService.UserMetaSnapshot(isFirstSync = false, lastSyncTimestamp = 1_000L))
        coEvery { dao.countArticlesModifiedSince(1_000L, any()) } returns 1
        coEvery { dao.getArticlesModifiedSinceKeyset(1_000L, any(), any(), any(), 50) } returns listOf(Article(itemId = "a1"))
        coEvery { dao.getTagsForArticles(listOf("a1")) } returns emptyList()
        coEvery { dao.getImagesForArticles(listOf("a1")) } returns emptyList()
        coEvery { dao.getAuthorsForArticles(listOf("a1")) } returns emptyList()
        coEvery { dao.getVideosForArticles(listOf("a1")) } returns emptyList()
        // Offline: the commit waits for the server and never completes.
        coEvery { backup.backupArticlesPaginated(any(), any(), any()) } coAnswers { awaitCancellation() }

        // Virtual time under runTest: the push timeout elapses at once.
        val result = realManager(dao, backup).pushLocalChanges()

        assertTrue(result.interruptedBy is SyncTimeoutException)
        assertEquals(0, result.pushed)
        assertEquals(0, result.failed)
        coVerify(exactly = 0) { dao.recordPushResults(any(), any()) }
        coVerify(exactly = 0) { backup.updateLastSyncTimestamp(any()) }
    }

    // ---- Classifier ----------------------------------------------------------

    @Test
    fun classifier_separatesTransientFromArticleFailures() {
        val transientCodes = setOf(
            FirebaseFirestoreException.Code.UNAVAILABLE,
            FirebaseFirestoreException.Code.DEADLINE_EXCEEDED,
            FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED,
            FirebaseFirestoreException.Code.ABORTED,
            FirebaseFirestoreException.Code.CANCELLED,
            FirebaseFirestoreException.Code.INTERNAL,
            FirebaseFirestoreException.Code.UNKNOWN,
            FirebaseFirestoreException.Code.UNAUTHENTICATED,
        )
        // OK is not a failure: the SDK refuses to build an exception with it.
        for (code in FirebaseFirestoreException.Code.values().filter { it != FirebaseFirestoreException.Code.OK }) {
            val error = FirebaseFirestoreException("x", code)
            assertEquals("code $code", code in transientCodes, error.isTransientSyncFailure())
            // A wrapped Firestore failure is classified by its cause.
            assertEquals("wrapped $code", code in transientCodes, RuntimeException(error).isTransientSyncFailure())
        }
        assertTrue(IOException("socket").isTransientSyncFailure())
        assertTrue(FirebaseNetworkException("no network").isTransientSyncFailure())
        assertTrue(SyncTimeoutException(120_000).isTransientSyncFailure())
        assertEquals(false, IllegalArgumentException("bad field").isTransientSyncFailure())
        assertEquals(false, IllegalStateException("bad state").isTransientSyncFailure())
    }

    private fun realManager(dao: ArticleDao, backup: FirestoreBackupService): FirestoreSyncManager {
        val user = mockk<FirebaseUser>().also { every { it.uid } returns "u1" }
        val auth = mockk<FirebaseAuth>().also { every { it.currentUser } returns user }
        return FirestoreSyncManager(
            context = context,
            firestore = mockk<FirebaseFirestore>(relaxed = true),
            auth = auth,
            articleDao = dao,
            firestoreBackupService = backup,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = TestLocalDataOwner.ownsEveryUid(),
        )
    }

    private companion object {
        val OUTCOMES = listOf(
            SyncRunResult(pushed = 3, failed = 0) to ListenableWorker.Result.success(),
            SyncRunResult(pushed = 0, failed = 0, noUser = true) to ListenableWorker.Result.success(),
            SyncRunResult(pushed = 2, failed = 1) to ListenableWorker.Result.retry(),
            SyncRunResult(pushed = 0, failed = 1) to ListenableWorker.Result.retry(),
            SyncRunResult(pushed = 0, failed = 0, interruptedBy = IOException("offline")) to
                ListenableWorker.Result.retry(),
        )
    }
}
