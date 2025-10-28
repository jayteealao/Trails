package com.jayteealao.trails.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.PocketDao
import com.jayteealao.trails.data.local.preferences.ControlDisplayMethod
import com.jayteealao.trails.data.local.preferences.UserPreferencesRepository
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
    private val userPreferencesRepository: UserPreferencesRepository,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel() {
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

    val preferenceFlow = sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.USE_FREEDIUM)
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM)
        )

    fun updatePreference(value: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.USE_FREEDIUM, value)
        }
    }

    val darkTheme = sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.DARK_MODE_ENABLED)
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED)
        )

    fun updateDarkTheme(enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED, enabled)
        }
    }

    val useCardLayout = sharedPreferencesManager.booleanFlow(
        key = SettingsPreferenceKeys.USE_CARD_LAYOUT,
        defaultValue = false
    )
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, false)
        )

    fun updateCardLayout(enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, enabled)
        }
    }

    val controlDisplayMethod = userPreferencesRepository.controlDisplayMethod
        .stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = userPreferencesRepository.getControlDisplayMethod()
        )

    fun updateControlDisplayMethod(method: ControlDisplayMethod) {
        viewModelScope.launch(ioDispatcher) {
            userPreferencesRepository.setControlDisplayMethod(method)
        }
    }
}
