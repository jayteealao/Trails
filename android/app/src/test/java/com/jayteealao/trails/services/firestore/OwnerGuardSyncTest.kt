package com.jayteealao.trails.services.firestore

import android.app.Application
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.local.database.ArticleDao
import io.mockk.coVerify
import io.mockk.confirmVerified
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The owner guard of the sync: a signed-in user who does not own the local library gets
 * neither a push nor a restore, and nothing is read before the check. The owner's own
 * session syncs as before.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class OwnerGuardSyncTest {

    private lateinit var owner: LocalDataOwner

    @Before
    fun setUp() {
        val prefs = SharedPreferencesManager(RuntimeEnvironment.getApplication())
        prefs.clear()
        owner = LocalDataOwner(prefs)
        owner.adopt("owner-a", "a@example.com")
    }

    private fun manager(signedInUid: String, dao: ArticleDao, backup: FirestoreBackupService): FirestoreSyncManager {
        val user = mockk<FirebaseUser>().also { every { it.uid } returns signedInUid }
        val auth = mockk<FirebaseAuth>().also { every { it.currentUser } returns user }
        return FirestoreSyncManager(
            context = RuntimeEnvironment.getApplication(),
            firestore = mockk<FirebaseFirestore>(),
            auth = auth,
            articleDao = dao,
            firestoreBackupService = backup,
            scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
            localDataOwner = owner,
        )
    }

    @Test
    fun push_byNonOwner_readsAndWritesNothing() = runTest {
        // Strict mocks: any DAO or backup call would throw.
        val dao = mockk<ArticleDao>()
        val backup = mockk<FirestoreBackupService>()

        val result = manager("user-b", dao, backup).pushLocalChanges()

        assertEquals(SyncRunStatus.NO_USER, result.status)
        confirmVerified(dao, backup)
    }

    @Test
    fun fullSync_byNonOwner_restoresNothing() = runTest {
        val dao = mockk<ArticleDao>()
        val backup = mockk<FirestoreBackupService>()

        val result = manager("user-b", dao, backup).fullSync()

        assertEquals(SyncRunStatus.NO_USER, result.status)
        confirmVerified(dao, backup)
    }

    @Test
    fun push_byOwner_proceeds() = runTest {
        val dao = mockk<ArticleDao>(relaxed = true)
        val backup = mockk<FirestoreBackupService>(relaxed = true)

        // Relaxed mocks may not satisfy the rest of the run; only reaching Firestore matters.
        runCatching { manager("owner-a", dao, backup).pushLocalChanges() }

        coVerify(exactly = 1) { backup.getUserMetaSnapshot() }
    }

    @Test
    fun push_afterOwnerCleared_proceedsForAnyone() = runTest {
        owner.clear()
        val dao = mockk<ArticleDao>(relaxed = true)
        val backup = mockk<FirestoreBackupService>(relaxed = true)

        // Relaxed mocks may not satisfy the rest of the run; only reaching Firestore matters.
        runCatching { manager("user-b", dao, backup).pushLocalChanges() }

        coVerify(exactly = 1) { backup.getUserMetaSnapshot() }
    }
}
