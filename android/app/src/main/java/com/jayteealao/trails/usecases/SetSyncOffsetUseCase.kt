package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject

class SetSyncOffsetUseCase @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(offset: Int) {
        sharedPreferencesManager.saveLong("sync_offset", offset.toLong())
    }
}