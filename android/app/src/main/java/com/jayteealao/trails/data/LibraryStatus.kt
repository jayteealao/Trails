package com.jayteealao.trails.data

import com.google.firebase.auth.FirebaseAuth
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.common.di.ApplicationScope
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreBackupService
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncRunStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/** Where bringing the library to this phone stands. */
sealed interface LibraryLoad {
    data object Idle : LibraryLoad

    /** A restore or a sync runs. */
    data object Loading : LibraryLoad

    /**
     * The restore did not finish.
     *
     * @property offline the phone had no network, so nothing was asked.
     * @property remoteCount the articles on the server, or null when the server did not say.
     */
    data class Failed(val offline: Boolean, val remoteCount: Int?) : LibraryLoad
}

/**
 * Why the library on this phone is empty, or that it is not.
 *
 * @property hasArticles whether a live article is on this phone; null before the first answer.
 * @property signedIn an account is signed in; a guest account counts.
 * @property email the email of the account, or null for a guest.
 */
data class LibraryState(
    val hasArticles: Boolean? = null,
    val signedIn: Boolean = false,
    val email: String? = null,
    val load: LibraryLoad = LibraryLoad.Idle,
)

/** Tells why the library is empty, and brings a signed-in person's articles back to an empty phone. */
interface LibraryStatus {
    val state: Flow<LibraryState>

    /**
     * Restores the library of the signed-in account when this phone has no article. Does nothing
     * when nobody is signed in, or when the restore of this account already ran in this process.
     */
    fun restoreIfEmpty()

    /** Runs [restoreIfEmpty] again, also after a restore that ran. */
    fun retry()
}

@Singleton
class DefaultLibraryStatus @Inject constructor(
    private val articleDao: ArticleDao,
    private val auth: FirebaseAuth,
    private val syncManager: FirestoreSyncManager,
    private val backupService: FirestoreBackupService,
    private val networkMonitor: NetworkMonitor,
    @ApplicationScope private val scope: CoroutineScope,
) : LibraryStatus {

    private data class Account(val uid: String, val email: String?)

    /** The one restore this process knows of: whose it is, and where it stands. Compared by identity. */
    private class Attempt(val uid: String, val load: LibraryLoad)

    private val attempt = MutableStateFlow<Attempt?>(null)

    /** The signed-in account now, then each change. */
    private val account: Flow<Account?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.account()) }
        trySend(auth.account())
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }.distinctUntilChanged()

    init {
        // A sign-out forgets the attempt, so the same account restores after its library was
        // cleared from this phone.
        scope.launch {
            account.collect { now -> attempt.update { if (it?.uid == now?.uid) it else null } }
        }
    }

    override val state: Flow<LibraryState> = combine(
        // Not known until the first answer, and when the read fails: the other parts still arrive.
        articleDao.observeHasArticles()
            .map<Boolean, Boolean?> { it }
            .onStart { emit(null) }
            .catch {
                Timber.e(it, "Could not read whether the library has articles")
                emit(null)
            },
        account,
        attempt,
        syncManager.isSyncing,
    ) { hasArticles, account, attempt, syncing ->
        LibraryState(
            hasArticles = hasArticles,
            signedIn = account != null,
            email = account?.email,
            load = when {
                syncing -> LibraryLoad.Loading
                attempt != null && attempt.uid == account?.uid -> attempt.load
                else -> LibraryLoad.Idle
            },
        )
    }.distinctUntilChanged()

    override fun restoreIfEmpty() = start(again = false)

    override fun retry() = start(again = true)

    private fun start(again: Boolean) {
        val uid = auth.currentUser?.uid ?: return
        val running = Attempt(uid, LibraryLoad.Loading)
        // The attempt says Loading from this call on, so an empty list never reads as a first run
        // while the rows are counted. Only the call that set it starts the restore.
        while (true) {
            val before = attempt.value
            if (before?.uid == uid && (before.load == LibraryLoad.Loading || !again)) return
            if (attempt.compareAndSet(before, running)) break
        }
        scope.launch {
            val after = try {
                restore()?.let { Attempt(uid, it) }
            } catch (e: CancellationException) {
                attempt.compareAndSet(running, null)
                throw e
            } catch (e: Exception) {
                Timber.e(e, "The restore of an empty library failed")
                Attempt(uid, LibraryLoad.Failed(offline = false, remoteCount = null))
            }
            // Refused when the account changed while the restore ran.
            attempt.compareAndSet(running, after)
        }
    }

    /** Where the restore ended, or null when none was needed, so the next open looks again. */
    private suspend fun restore(): LibraryLoad? {
        if (articleDao.countAllArticles() > 0) return null
        if (!networkMonitor.isOnline.first()) return LibraryLoad.Failed(offline = true, remoteCount = null)
        return when (syncManager.fullSync().status) {
            SyncRunStatus.SUCCESS -> LibraryLoad.Idle
            SyncRunStatus.NO_USER -> null
            SyncRunStatus.PARTIAL_FAILURE, SyncRunStatus.FAILURE -> {
                val count = backupService.getRemoteArticleCount().getOrNull()
                currentCoroutineContext().ensureActive()
                LibraryLoad.Failed(offline = false, remoteCount = count)
            }
        }
    }

    private fun FirebaseAuth.account(): Account? =
        currentUser?.let { Account(it.uid, it.email?.takeIf(String::isNotBlank)) }
}
