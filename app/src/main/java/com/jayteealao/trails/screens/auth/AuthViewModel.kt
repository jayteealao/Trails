package com.jayteealao.trails.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseUser
import com.jayteealao.trails.data.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
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

    init {
        val currentUser = authRepository.getCurrentUser()
        if (currentUser != null) {
            _uiState.value = AuthUiState.SignedIn(currentUser)
        }
    }

    fun signInWithCredential(credential: AuthCredential) {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            try {
                val result = authRepository.signInWithCredential(credential)
                _uiState.value = AuthUiState.SignedIn(result.user!!)
                // Navigation is now handled by observing the SignedIn state in AuthScreen
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to sign in"))
            }
        }
    }

    fun signInAnonymously() {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            try {
                val result = authRepository.signInAnonymously()
                _uiState.value = AuthUiState.SignedIn(result.user!!)
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to sign in as guest"))
            }
        }
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
                _uiState.value = AuthUiState.SignedIn(result.user!!)
                _event.emit(AuthEvent.ShowToast("Account upgraded successfully!"))
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to upgrade account"))
            }
        }
    }
}

sealed interface AuthUiState {
    object Loading : AuthUiState
    object SignedOut : AuthUiState
    data class SignedIn(val user: FirebaseUser) : AuthUiState
    data class Error(val throwable: Throwable) : AuthUiState
}
