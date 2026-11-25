package com.jayteealao.trails.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.data.AuthRepository
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
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val localDataOwner: LocalDataOwner,
    private val pushThenWipe: PushThenWipe,
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
    private suspend fun completeSignIn(user: FirebaseUser) {
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
        localDataOwner.adopt(user.uid, user.email)
        _uiState.value = AuthUiState.SignedIn(user)
    }

    fun signInWithCredential(credential: AuthCredential) {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            try {
                val result = authRepository.signInWithCredential(credential)
                completeSignIn(result.user!!)
                // Navigation is now handled by observing the SignedIn state in AuthScreen
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                signInFailed(e)
            }
        }
    }

    fun signInAnonymously() {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            try {
                val result = authRepository.signInAnonymously()
                completeSignIn(result.user!!)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                signInFailed(e)
            }
        }
    }

    /** Shows that a sign-in failed, also one that failed before it reached this ViewModel. */
    fun signInFailed(cause: Exception) {
        Timber.e(cause, "Sign-in failed")
        _uiState.value = AuthUiState.Error(signInErrorOf(cause))
    }

    fun signOut() {
        authRepository.signOut()
        _uiState.value = AuthUiState.SignedOut
    }

    fun linkWithCredential(credential: AuthCredential) {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            try {
                val result = authRepository.linkWithCredential(credential)
                completeSignIn(result.user!!)
                if (_uiState.value is AuthUiState.SignedIn) {
                    _event.emit(AuthEvent.ShowToast("Account upgraded successfully!"))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                signInFailed(e)
            }
        }
    }
}

sealed interface AuthUiState {
    object Loading : AuthUiState
    object SignedOut : AuthUiState
    data class SignedIn(val user: FirebaseUser) : AuthUiState
    data class Error(val message: ErrorMessage) : AuthUiState
}
