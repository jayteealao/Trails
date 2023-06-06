package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject

class GetSyncIncompleteErrorFromPrefs @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(): String? {
        return sharedPreferencesManager.getString("sync_incomplete_error")
    }
}