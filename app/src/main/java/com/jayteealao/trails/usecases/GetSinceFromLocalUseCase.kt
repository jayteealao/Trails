package com.jayteealao.trails.usecases

import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.ArticleDao
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

class GetSinceFromLocalUseCase @Inject constructor(
    private val articleDao: ArticleDao,
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    operator fun invoke(): Long? {
        return sharedPreferencesManager.getLong("since")
            ?: articleDao.getLatestArticle()?.timeAdded
    }
}