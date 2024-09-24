package com.jayteealao.trails.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.local.database.PocketDao
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val pocketDao: PocketDao,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel() {
    fun resetSemanticCache() {
        viewModelScope.launch(ioDispatcher) {
            pocketDao.clearModalTable()
        }
    }
}