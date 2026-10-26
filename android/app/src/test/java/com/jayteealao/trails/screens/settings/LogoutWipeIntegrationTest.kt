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
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.LocalDataReset
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.local.database.AppDatabase
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunResult
import com.jayteealao.trails.services.firestore.SyncStatus
import com.jayteealao.trails.testing.JvmRoomDatabase
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
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
 * database and the real archive folder: logging out keeps every row and file; clearing
 * with nothing pending empties every table and deletes the folder without asking.
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
        val user = mockk<FirebaseUser>().also {
            every { it.uid } returns "owner-a"
            every { it.email } returns "a@example.com"
            every { it.isAnonymous } returns false
        }
        every { authRepository.getCurrentUser() } returns user
        archives = File(context.filesDir, LocalDataReset.ARCHIVES_DIR)
        archives.deleteRecursively()
    }

    @After
    fun tearDown() {
        db.close()
        archives.deleteRecursively()
        Dispatchers.resetMain()
    }

    private fun viewModel(): SettingsViewModel {
        val syncManager = mockk<FirestoreSyncManager>()
        every { syncManager.isSyncing } returns MutableStateFlow(false)
        every { syncManager.lastSyncTime } returns MutableStateFlow(0L)
        every { syncManager.syncStatus } returns MutableStateFlow<SyncStatus>(SyncStatus.Idle)
        every { syncManager.lastError } returns MutableStateFlow<String?>(null)
        coEvery { syncManager.pushLocalChanges() } returns SyncRunResult(0, 0)
        coEvery { syncManager.runExclusive<Unit>(any()) } coAnswers { firstArg<suspend () -> Unit>().invoke() }
        val owner = LocalDataOwner(prefs).also { it.adopt("owner-a", "a@example.com") }
        val reset = LocalDataReset(context, db.articleDao(), syncManager)
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

    /** Every table seeded, every article stamped as backed up, one archive file on disk. */
    private suspend fun seed() {
        db.articleDao().upsertArticles(
            listOf("a1", "a2").map {
                Article(
                    itemId = it,
                    title = "River $it",
                    url = "https://example.com/$it",
                    timeAdded = 1_000,
                    timeUpdated = 2_000,
                    backedUpAt = 2_000,
                )
            }
        )
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
        val vm = viewModel()
        val events = Channel<SettingsEvent>(Channel.UNLIMITED)
        val dialogs = mutableListOf<Any>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.event.collect { events.send(it) } }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.state.collect { dialogs += it.unsyncedChangesDialog }
        }

        vm.logout(clearData = false)
        awaitLoggedOut(events)

        assertEquals(before, counts())
        assertEquals(filesBefore, archiveListing())

        vm.logout(clearData = true)
        awaitLoggedOut(events)

        assertTrue(counts().values.all { it == 0L })
        assertFalse(archives.exists())
        // Nothing was pending, so the person was never asked (a question would block the run).
        assertTrue(dialogs.none { it is com.jayteealao.trails.data.account.UnsyncedChangesDialogState.PushFailed })
        verify(exactly = 2) { authRepository.signOut() }
    }

    /** Room and the view model work on real threads here, so wait in real time. */
    private suspend fun awaitLoggedOut(events: Channel<SettingsEvent>) = withContext(Dispatchers.Default) {
        withTimeout(10_000) {
            while (events.receive() != SettingsEvent.LoggedOut) Unit
        }
    }

    private companion object {
        val TABLES = listOf(
            "article", "article_tags", "article_images", "article_videos",
            "article_authors", "DomainMetadata", "local_archive",
        )
    }
}
