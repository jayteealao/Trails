package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.PocketDao
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

class GetSinceFromLocalUseCase @Inject constructor(
    private val pocketDao: PocketDao,
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(): Long? {
        return sharedPreferencesManager.getLong("since")
            ?: pocketDao.getLatestArticle()?.timeAdded
    }
}