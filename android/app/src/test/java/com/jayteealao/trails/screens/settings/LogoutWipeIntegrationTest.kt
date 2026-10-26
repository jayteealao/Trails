package com.jayteealao.trails.screens.settings

import com.jayteealao.trails.services.firestore.SyncFailures
import android.app.Application
import android.content.Context
import androidx.room3.executeSQL
import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.LocalDataReset
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.SyncState
import com.jayteealao.trails.screens.auth.AuthUiState
import com.jayteealao.trails.screens.auth.AuthViewModel
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncStatus
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * "Logout only" and "Clear data" from the Settings view model down to a real in-memory
 * database and the real archive folder: logging out sends the pending change while the
 * owner is signed in and keeps every row and file; clearing with nothing pending empties
 * every table and deletes the folder without asking; and after "Logout only" another
 * account's sign-in clears the device without a question.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class LogoutWipeIntegrationTest {

    private lateinit var context: Context
    private lateinit var db: AppDatabase
    private lateinit var prefs: SharedPreferencesManager
    private lateinit var authRepository: AuthRepository
    private lateinit var archives: File
    private lateinit var syncManager: FirestoreSyncManager
    private lateinit var owner: LocalDataOwner
    private lateinit var reset: LocalDataReset

    /** Who is signed in; sign-out clears it. */
    private var currentUser: FirebaseUser? = null

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        context = RuntimeEnvironment.getApplication()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build()
        )
        db = JvmRoomDatabase.create(context)
        prefs = SharedPreferencesManager(context)
        prefs.clear()
        authRepository = mockk(relaxed = true)
        currentUser = user("owner-a", "a@example.com")
        every { authRepository.getCurrentUser() } answers { currentUser }
        every { authRepository.signOut() } answers { currentUser = null }
        archives = File(context.filesDir, LocalDataReset.ARCHIVES_DIR)
        archives.deleteRecursively()

        syncManager = mockk()
        every { syncManager.isSyncing } returns MutableStateFlow(false)
        every { syncManager.lastSyncTime } returns MutableStateFlow(0L)
        every { syncManager.syncStatus } returns MutableStateFlow<SyncStatus>(SyncStatus.Idle)
        every { syncManager.lastError } returns MutableStateFlow<String?>(null)
        // The push sends the one unsynced edit and stamps it, as the real push does.
        coEvery { syncManager.pushLocalChanges() } coAnswers {
            db.articleDao().recordPushResults(succeeded = mapOf("a2" to EDITED_AT), failed = emptyList())
            SyncRunResult(1, 0)
        }
        coEvery { syncManager.runExclusive<Unit>(any()) } coAnswers { firstArg<suspend () -> Unit>().invoke() }
        owner = LocalDataOwner(prefs).also { it.adopt("owner-a", "a@example.com") }
        reset = LocalDataReset(context, db.articleDao(), syncManager)
    }

    private fun user(uid: String, email: String?) = mockk<FirebaseUser>().also {
        every { it.uid } returns uid
        every { it.email } returns email
        every { it.isAnonymous } returns (email == null)
    }

    @After
    fun tearDown() {
        db.close()
        archives.deleteRecursively()
        Dispatchers.resetMain()
    }

    private fun viewModel(): SettingsViewModel {
        return SettingsViewModel(
            syncFailures = SyncFailures(db.articleDao(), syncManager),
            sharedPreferencesManager = prefs,
            firestoreSyncManager = syncManager,
            authRepository = authRepository,
            ioDispatcher = Dispatchers.IO,
            pushThenWipe = PushThenWipe(reset),
            localDataOwner = owner,
        )
    }

    /**
     * Every table seeded, one archive file on disk; a1 is backed up and a2 carries one edit
     * made after its last backup (an unsynced change).
     */
    private suspend fun seed() {
        db.articleDao().upsertArticles(
            listOf("a1", "a2").map {
                Article(
                    itemId = it,
                    title = "River $it",
                    url = "https://example.com/$it",
                    timeAdded = 1_000,
                    timeUpdated = if (it == "a2") EDITED_AT else 2_000,
                )
            }
        )
        listOf("a1", "a2").forEach { db.articleDao().upsertSyncState(SyncState(it, 2_000)) }
        db.useWriterConnection { connection ->
            connection.executeSQL("INSERT INTO article_tags (itemId, tag) VALUES ('a1', 'water')")
            connection.executeSQL(
                "INSERT INTO article_images (imageId, itemId, src, width, height, credit, caption) " +
                    "VALUES ('i1', 'a1', 'https://example.com/i.png', 1, 1, '', '')"
            )
            connection.executeSQL(
                "INSERT INTO article_videos (videoId, itemId, src, width, height, type, vid) " +
                    "VALUES ('v1', 'a1', 'https://example.com/v.mp4', 1, 1, 'mp4', 'v1')"
            )
            connection.executeSQL(
                "INSERT INTO article_authors (authorId, itemId, name, url) VALUES ('au1', 'a1', 'Ann', 'https://example.com/ann')"
            )
            connection.executeSQL("INSERT INTO DomainMetadata (name, domain) VALUES ('Example', 'example.com')")
            connection.executeSQL(
                "INSERT INTO local_archive (itemId, archiveKey, localPath, compressedSizeBytes, originalSizeBytes, downloadedAt, status) " +
                    "VALUES ('a1', 'readability', 'archives/a1/readability.gz', 10, 20, 1000, 'complete')"
            )
        }
        File(archives, "a1").mkdirs()
        File(archives, "a1/readability.gz").writeText("archived page")
    }

    private suspend fun counts(): Map<String, Long> = db.useReaderConnection { connection ->
        TABLES.associateWith { table ->
            connection.usePrepared("SELECT COUNT(*) FROM $table") { stmt ->
                stmt.step()
                stmt.getLong(0)
            }
        }
    }

    private fun archiveListing(): List<String> =
        archives.walkTopDown().map { it.relativeTo(context.filesDir).path.replace('\\', '/') }.sorted().toList()

    @Test
    fun logoutOnly_keepsEveryRowAndFile_clearDataEmptiesEverything() = runTest {
        seed()
        val before = counts()
        val filesBefore = archiveListing()
        assertTrue(before.values.all { it > 0 })
        assertEquals(1, db.articleDao().countUnsyncedChanges())
        val vm = viewModel()
        val events = Channel<SettingsEvent>(Channel.UNLIMITED)
        val dialogs = mutableListOf<Any>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.event.collect { events.send(it) } }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.state.collect { dialogs += it.unsyncedChangesDialog }
        }

        vm.logout(clearData = false)
        awaitLoggedOut(events)

        // The edit went out while the owner was still signed in.
        coVerifyOrder {
            syncManager.pushLocalChanges()
            authRepository.signOut()
        }
        coVerify(exactly = 1) { syncManager.pushLocalChanges() }
        assertEquals(0, db.articleDao().countUnsyncedChanges())
        assertEquals(before, counts())
        assertEquals(filesBefore, archiveListing())
        assertEquals("owner-a", owner.uid())

        currentUser = user("owner-a", "a@example.com")
        vm.logout(clearData = true)
        awaitLoggedOut(events)

        assertTrue(counts().values.all { it == 0L })
        assertFalse(archives.exists())
        // Nothing was pending, so the person was never asked (a question would block the run).
        assertTrue(dialogs.none { it is UnsyncedChangesDialogState.PushFailed })
        verify(exactly = 2) { authRepository.signOut() }
    }

    @Test
    fun logoutOnlyThenAnotherAccount_clearsWithoutAQuestion() = runTest {
        seed()
        val vm = viewModel()
        val events = Channel<SettingsEvent>(Channel.UNLIMITED)
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.event.collect { events.send(it) } }

        vm.logout(clearData = false)
        awaitLoggedOut(events)
        assertEquals(0, db.articleDao().countUnsyncedChanges())

        // Another account signs in on the same device, over the same owner store and reset.
        val auth = AuthViewModel(authRepository, owner, PushThenWipe(reset))
        val switchDialogs = mutableListOf<UnsyncedChangesDialogState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            auth.unsyncedChangesDialog.collect { switchDialogs += it }
        }
        val b = user("owner-b", "b@example.com")
        coEvery { authRepository.signInAnonymously() } returns mockk<AuthResult>().also { every { it.user } returns b }

        auth.signInAnonymously()
        withContext(Dispatchers.Default) {
            withTimeout(10_000) { auth.state.first { it is AuthUiState.SignedIn } }
        }

        assertTrue(switchDialogs.none { it is UnsyncedChangesDialogState.PushFailed })
        assertTrue(counts().values.all { it == 0L })
        assertFalse(archives.exists())
        assertEquals("owner-b", owner.uid())
        assertEquals(AuthUiState.SignedIn(b), auth.state.value)
        // No push ever ran as the new account; only the logout push did.
        coVerify(exactly = 1) { syncManager.pushLocalChanges() }
    }

    /** Room and the view model work on real threads here, so wait in real time. */
    private suspend fun awaitLoggedOut(events: Channel<SettingsEvent>) = withContext(Dispatchers.Default) {
        withTimeout(10_000) {
            while (events.receive() != SettingsEvent.LoggedOut) Unit
        }
    }

    private companion object {
        /** When a2 was edited, after its last backup at 2 000. */
        const val EDITED_AT = 3_000L

        val TABLES = listOf(
            "article", "article_tags", "article_images", "article_videos",
            "article_authors", "DomainMetadata", "local_archive",
        )
    }
}
