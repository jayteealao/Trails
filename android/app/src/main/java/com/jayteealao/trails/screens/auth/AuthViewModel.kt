package com.jayteealao.trails.screens.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.account.GoogleSignIn
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.OwnerDecision
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.account.PushThenWipeResult
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.screens.components.ErrorMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localDataOwner: LocalDataOwner,
    private val pushThenWipe: PushThenWipe,
    private val googleSignIn: GoogleSignIn,
    private val networkMonitor: NetworkMonitor,
) : ViewModel(), Store<AuthUiState, AuthEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<AuthEvent>()
    override val event: SharedFlow<AuthEvent> = _event.asSharedFlow()

    // Tartlet Store implementation - State
    private val _uiState: MutableStateFlow<AuthUiState> = MutableStateFlow(AuthUiState.SignedOut)
    override val state: StateFlow<AuthUiState> = _uiState.asStateFlow()

    val isLoggedIn = _uiState.map {
        it is AuthUiState.SignedIn
    }

    /** The unsynced-changes dialog shown while another account's library is cleared. */
    private val _unsyncedChangesDialog =
        MutableStateFlow<UnsyncedChangesDialogState>(UnsyncedChangesDialogState.Hidden)
    val unsyncedChangesDialog: StateFlow<UnsyncedChangesDialogState> = _unsyncedChangesDialog.asStateFlow()

    /** The person's answer to the push-failed dialog: true clears the device. */
    private var switchAnswer: CompletableDeferred<Boolean>? = null

    init {
        val currentUser = authRepository.getCurrentUser()
        if (currentUser != null) {
            when (localDataOwner.decide(currentUser.uid)) {
                OwnerDecision.ADOPT, OwnerDecision.SAME_OWNER -> {
                    localDataOwner.adopt(currentUser.uid, currentUser.email)
                    _uiState.value = AuthUiState.SignedIn(currentUser)
                }
                // Only an interrupted account switch leaves another user signed in over
                // this library: sign them out rather than show them the previous library.
                OwnerDecision.DIFFERENT_OWNER -> authRepository.signOut()
            }
        }
    }

    fun keepPreviousAccountData() {
        switchAnswer?.complete(false)
    }

    fun switchAccountAnyway() {
        switchAnswer?.complete(true)
    }

    /**
     * Hands the library to [user]. When another account owns it, the device is cleared
     * first (the person confirms when changes are not backed up), so a restore can only
     * start after the wipe and the new owner.
     */
    private suspend fun completeSignIn(user: FirebaseUser, label: String? = user.email) {
        if (localDataOwner.decide(user.uid) == OwnerDecision.DIFFERENT_OWNER) {
            val result = try {
                // No push as [user]: it would write the previous library into this account.
                // "Logout only" already pushed the previous owner's changes while they were
                // signed in, so this usually clears the device with no question; changes
                // still unsent are the person's call.
                pushThenWipe.run(
                    reason = WipeReason.ACCOUNT_SWITCH,
                    ownerLabel = localDataOwner.label(),
                    canPush = false,
                    onState = { _unsyncedChangesDialog.value = it },
                    confirm = {
                        val answer = CompletableDeferred<Boolean>()
                        switchAnswer = answer
                        try {
                            answer.await()
                        } finally {
                            switchAnswer = null
                        }
                    },
                )
            } catch (e: Throwable) {
                authRepository.signOut()
                throw e
            }
            if (result == PushThenWipeResult.KEPT) {
                authRepository.signOut()
                _uiState.value = AuthUiState.SignedOut
                return
            }
        }
        localDataOwner.adopt(user.uid, label)
        _uiState.value = AuthUiState.SignedIn(user)
    }

    /**
     * Signs in with the Google account that the person picks. [activity] shows the picker and
     * is not kept. A cancel in the picker shows what was there before.
     */
    fun signInWithGoogle(activity: Context) {
        val before = _uiState.value
        startAttempt { current ->
            var email: String? = null
            val user = try {
                val account = googleSignIn.account(activity)
                email = account.email
                firebaseSignIn(current) { authRepository.signInWithGoogle(account.idToken) } ?: return@startAttempt
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Google sign-in failed")
                _uiState.value = when (val message = googleSignInErrorOf(e, networkMonitor.isOnline.first())) {
                    null -> before.takeIf { it.isRestful() } ?: AuthUiState.SignedOut
                    ErrorMessage.GOOGLE_NO_ACCOUNT -> AuthUiState.NoGoogleAccount
                    ErrorMessage.GOOGLE_FAILED -> AuthUiState.Error(message, account = email)
                    else -> AuthUiState.Error(message)
                }
                return@startAttempt
            }
            handOver(user)
        }
    }

    fun signInAnonymously() {
        startAttempt { current ->
            val user = try {
                firebaseSignIn(current) { authRepository.signInAnonymously() } ?: return@startAttempt
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                signInFailed(e)
                return@startAttempt
            }
            handOver(user)
        }
    }

    /**
     * Stops a sign-in that can still be stopped: the picker closes and the screen is signed out
     * at once. An account that Firebase still signs in for it is signed out again.
     */
    fun cancelSignIn() {
        val current = attempt ?: return
        val state = _uiState.value
        if (state !is AuthUiState.Loading || !state.canCancel) return
        current.cancelled = true
        current.job?.cancel()
        _uiState.value = AuthUiState.SignedOut
    }

    /** The phone's account settings closed: offer Google again. */
    fun accountSettingsClosed() {
        if (_uiState.value == AuthUiState.NoGoogleAccount) _uiState.value = AuthUiState.SignedOut
    }

    /** One sign-in at a time; [cancelled] marks one that the person stopped. */
    private class Attempt {
        var job: Job? = null
        var cancelled = false
    }

    private var attempt: Attempt? = null

    /**
     * Runs [block] as the one sign-in. A call while another runs is ignored. A stopped attempt
     * may still be waiting for Firebase, so the next one waits for it first: it cannot then
     * sign out the newer account.
     */
    private fun startAttempt(block: suspend (Attempt) -> Unit) {
        val previous = attempt
        if (previous != null && !previous.cancelled) return
        val current = Attempt()
        attempt = current
        _uiState.value = AuthUiState.Loading()
        current.job = viewModelScope.launch {
            try {
                previous?.job?.join()
                block(current)
            } finally {
                if (attempt === current) attempt = null
            }
        }
    }

    /**
     * Runs the Firebase sign-in to its end even when the attempt is stopped, because stopping
     * the wait does not stop Firebase. A stopped attempt signs its account out again and gives
     * null; a failure of a stopped one says nothing. Otherwise the hand-over starts at once and
     * can no longer be stopped.
     */
    private suspend fun firebaseSignIn(current: Attempt, call: suspend () -> AuthResult): FirebaseUser? =
        withContext(NonCancellable) {
            val user = try {
                call().user ?: throw IllegalStateException("Firebase gave no user")
            } catch (e: Exception) {
                if (current.cancelled) return@withContext null
                throw e
            }
            if (current.cancelled) {
                authRepository.signOut()
                null
            } else {
                _uiState.value = AuthUiState.Loading(canCancel = false)
                user
            }
        }

    /** Hands the library to [user]; a failure here signs nobody in. */
    private suspend fun handOver(user: FirebaseUser) {
        try {
            completeSignIn(user)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Sign-in hand-over failed")
            _uiState.value = AuthUiState.Error(ErrorMessage.SIGN_IN_FAILED)
        }
    }

    /** Shows that a guest sign-in failed. */
    private fun signInFailed(cause: Exception) {
        Timber.e(cause, "Sign-in failed")
        _uiState.value = AuthUiState.Error(signInErrorOf(cause))
    }

    /**
     * The person's logout: a running upgrade stops, Firebase signs out, and the credential
     * providers are told, best effort. Startup never calls this.
     */
    fun signOut() {
        upgradeJob?.cancel()
        upgradeJob = null
        _upgrade.value = UpgradeState.Idle
        authRepository.signOut()
        _uiState.value = AuthUiState.SignedOut
        viewModelScope.launch {
            try {
                googleSignIn.forget()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.w(e, "The credential providers were not told of the sign-out")
            }
        }
    }

    private val _upgrade = MutableStateFlow(UpgradeState.Idle)

    /** The account upgrade from Settings; it never changes [state] until it succeeds. */
    val upgrade: StateFlow<UpgradeState> = _upgrade.asStateFlow()

    private var upgradeJob: Job? = null

    /**
     * Adds the Google account that the person picks to the signed-in guest. The uid stays, so
     * the library stays. A failure leaves the guest signed in on Settings with a message; it
     * never falls back to a sign-in, which would replace the guest. [activity] is not kept.
     */
    fun upgradeAccount(activity: Context) {
        if (_upgrade.value == UpgradeState.Running) return
        if (_uiState.value !is AuthUiState.SignedIn) return
        _upgrade.value = UpgradeState.Running
        upgradeJob = viewModelScope.launch {
            try {
                val account = googleSignIn.account(activity)
                val user = authRepository.linkGoogle(account.idToken).user
                    ?: throw IllegalStateException("Firebase gave no user")
                completeSignIn(user, label = user.email ?: account.email)
                _upgrade.value = UpgradeState.Done
                _event.emit(AuthEvent.Upgraded)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Account upgrade failed")
                _upgrade.value = UpgradeState.Idle
                upgradeErrorOf(e, networkMonitor.isOnline.first())?.let { _event.emit(AuthEvent.UpgradeFailed(it)) }
            }
        }
    }

}

/** Where the account upgrade stands. */
enum class UpgradeState { Idle, Running, Done }

/** A state with no sign-in running, which a cancelled picker goes back to. */
private fun AuthUiState.isRestful(): Boolean =
    this == AuthUiState.SignedOut || this == AuthUiState.NoGoogleAccount || this is AuthUiState.Error

sealed interface AuthUiState {
    /** A sign-in runs; [canCancel] is false once the library is being handed over. */
    data class Loading(val canCancel: Boolean = true) : AuthUiState
    data object SignedOut : AuthUiState
    /** Google found no account on this phone. */
    data object NoGoogleAccount : AuthUiState
    data class SignedIn(val user: FirebaseUser) : AuthUiState
    /** A failed sign-in; [account] is the Google address when Google gave one. */
    data class Error(val message: ErrorMessage, val account: String? = null) : AuthUiState
}
