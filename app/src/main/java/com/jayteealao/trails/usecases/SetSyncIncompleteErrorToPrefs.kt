package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject

class SetSyncIncompleteErrorToPrefs @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(error: String) {
        sharedPreferencesManager.saveString("sync_incomplete_error", error)
    }
}