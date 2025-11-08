package com.jayteealao.trails.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.CONSUMERKEY
import com.jayteealao.trails.usecases.AuthorizeTokenUseCase
import com.jayteealao.trails.usecases.GetAccessTokenFromLocalUseCase
import com.jayteealao.trails.usecases.GetAccessTokenFromNetworkUseCase
import com.jayteealao.trails.usecases.GetRequestTokenUseCase
import com.skydoves.sandwich.suspendOnSuccess
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
    private val authorizeTokenUseCase: AuthorizeTokenUseCase,
    private val getAccessTokenFromLocalUseCase: GetAccessTokenFromLocalUseCase,
    private val getAccessTokenFromNetworkUseCase: GetAccessTokenFromNetworkUseCase,
    private val getRequestTokenUseCase: GetRequestTokenUseCase
) : ViewModel(), Store<AuthUiState, AuthEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<AuthEvent>()
    override val event: SharedFlow<AuthEvent> = _event.asSharedFlow()

    // Tartlet Store implementation - State
    private val _uiState: MutableStateFlow<AuthUiState> = MutableStateFlow(AuthUiState.NeedAuth)
    override val state: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        getAccessTokenFromLocal()
    }

    private var requestToken: String = ""

    val isLoggedIn = _uiState.map {
        it is AuthUiState.AccessToken
    }

    // Actions
    fun getRequestToken() {
        viewModelScope.launch {
            try {
                getRequestTokenUseCase(CONSUMERKEY, "https://example.com")
                    .suspendOnSuccess {
                        _uiState.value = AuthUiState.RequestToken(data.code)
                    }
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to get request token"))
            }
        }
    }

    private fun getAccessTokenFromLocal() {
        viewModelScope.launch {
            getAccessTokenFromLocalUseCase()
                .collect {
                    if (it != null) {
                        _uiState.value = AuthUiState.AccessToken(it)
                        _event.emit(AuthEvent.NavigateToMain)
                    } else {
                        _uiState.value = AuthUiState.NeedAuth
                    }
                }
        }
    }

    fun authorizeWithBrowser(requestToken: String) {
        viewModelScope.launch {
            try {
                val intent = authorizeTokenUseCase(requestToken, "https://example.com")
                _uiState.value = AuthUiState.Loading
                this@AuthViewModel.requestToken = requestToken
                _event.emit(AuthEvent.OpenBrowserForAuth(intent))
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to authorize"))
            }
        }
    }

    fun getNetworkAccessToken() {
        viewModelScope.launch {
            try {
                val result = getAccessTokenFromNetworkUseCase(CONSUMERKEY, requestToken)
                if (result.isSuccess) {
                    _uiState.emit(AuthUiState.AccessToken(result.getOrNull()!!))
                    _event.emit(AuthEvent.NavigateToMain)
                } else {
                    val error = result.exceptionOrNull()!!
                    _uiState.emit(AuthUiState.Error(error))
                    _event.emit(AuthEvent.ShowError(error.message ?: "Failed to get access token"))
                }
            } catch (e: Exception) {
                _uiState.value = AuthUiState.Error(e)
                _event.emit(AuthEvent.ShowError(e.message ?: "Failed to get access token"))
            }
        }
    }
}

sealed interface AuthUiState {
    object Loading : AuthUiState
    object NeedAuth : AuthUiState
    data class RequestToken(val data: String) : AuthUiState
    data class AccessToken(val data: String) : AuthUiState
    data class Error(val throwable: Throwable) : AuthUiState
}