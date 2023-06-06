package com.jayteealao.trails.usecases

import com.jayteealao.trails.common.ACCESSTOKEN
import com.jayteealao.trails.data.SharedPreferencesManager
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GetAccessTokenFromLocalUseCase @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke() = flow {
        val accessToken = sharedPreferencesManager.getString(ACCESSTOKEN)
        if (accessToken != null) {
            emit(accessToken)
        } else {
            emit(null)
        }
    }
}