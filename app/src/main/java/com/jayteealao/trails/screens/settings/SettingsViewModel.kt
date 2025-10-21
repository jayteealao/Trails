package com.jayteealao.trails.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.PocketDao
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val pocketDao: PocketDao,
    private val sharedPreferencesManager: SharedPreferencesManager,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel() {
    companion object {
        private const val KEY_USE_FREEDIUM = "USE_FREEDIUM"
        private const val KEY_DARK_MODE = "DARK_MODE_ENABLED"
    }
    fun resetSemanticCache() {
        viewModelScope.launch(ioDispatcher) {
//            pocketDao.clearModalTable()
        }
    }
    var _jinaToken = MutableStateFlow("")

    val jinaToken: StateFlow<String>
        get() = _jinaToken

    fun updateJinaToken(token: String) {
        _jinaToken.value = token
    }

    val jinaPlaceHolder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here"

    fun updateJinaTokenPreferences() {
        sharedPreferencesManager.saveString("JINA_TOKEN", jinaToken.value)
    }

    val preferenceFlow = sharedPreferencesManager.booleanFlow(KEY_USE_FREEDIUM)
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(KEY_USE_FREEDIUM)
        )

    fun updatePreference(value: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(KEY_USE_FREEDIUM, value)
        }
    }

    val darkTheme = sharedPreferencesManager.booleanFlow(KEY_DARK_MODE)
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(KEY_DARK_MODE)
        )

    fun updateDarkTheme(enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(KEY_DARK_MODE, enabled)
        }
    }
}