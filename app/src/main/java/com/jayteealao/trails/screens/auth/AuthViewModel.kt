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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
) : ViewModel()  {

    private val _uiState: MutableStateFlow<AuthUiState> = MutableStateFlow(AuthUiState.NeedAuth)

    init {
        getAccessTokenFromLocal()
    }

    var requestToken: String = ""

    val isLoggedIn = _uiState.map {
        it is AuthUiState.AccessToken
    }

    val uiState: StateFlow<AuthUiState>
        get() = _uiState.asStateFlow()

    fun getRequestToken() {
        viewModelScope.launch {
            getRequestTokenUseCase(CONSUMERKEY, "https://example.com")
                .suspendOnSuccess {
                    _uiState.value = AuthUiState.RequestToken(data.code)
                }
        }
    }

    private fun getAccessTokenFromLocal() {
        viewModelScope.launch {
            getAccessTokenFromLocalUseCase()
                .collect {
                    if (it != null) {
                        _uiState.value = AuthUiState.AccessToken(it)
                    } else {
                        _uiState.value = AuthUiState.NeedAuth
                    }
                }
        }
    }

    fun authorizeIntent(requestToken: String) = authorizeTokenUseCase(
        requestToken,
        "https://example.com"
    ).also {
        _uiState.value = AuthUiState.Loading
        this.requestToken = requestToken
    }

    fun getNetworkAccessToken(requestToken: String): Result<String> {
        var result: Result<String> = Result.failure(Throwable("failed to retrieve access token"))
        viewModelScope.launch {
            result = getAccessTokenFromNetworkUseCase(CONSUMERKEY, requestToken)
            _uiState.emit(AuthUiState.AccessToken(result.getOrNull()!!))
            if (result.isFailure) _uiState.emit(AuthUiState.Error(result.exceptionOrNull()!!))
        }
        return result
    }
}

sealed interface AuthUiState {
    object Loading : AuthUiState
    object NeedAuth : AuthUiState
    data class RequestToken(val data: String) : AuthUiState
    data class AccessToken(val data: String) : AuthUiState
    data class Error(val throwable: Throwable) : AuthUiState
}