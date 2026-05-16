package com.jayteealao.trails.usecases

import com.jayteealao.trails.common.ACCESSTOKEN
import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject

class SetAccessTokenUseCase @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(accessToken: String) {
        sharedPreferencesManager.saveString(ACCESSTOKEN, accessToken)
    }
}