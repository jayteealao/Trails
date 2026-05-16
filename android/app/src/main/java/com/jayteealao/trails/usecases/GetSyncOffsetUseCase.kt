package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import javax.inject.Inject

class GetSyncOffsetUseCase @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
){
    operator fun invoke(): Long? {
        return sharedPreferencesManager.getLong("sync_offset")
    }
}