package com.jayteealao.trails.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.local.database.ArticleDao
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val articleDao: ArticleDao,
    private val sharedPreferencesManager: SharedPreferencesManager,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<SettingsState, SettingsEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<SettingsEvent>()
    override val event: SharedFlow<SettingsEvent> = _event.asSharedFlow()

    // Internal mutable token state (not part of consolidated state as it's ephemeral)
    private val _jinaToken = MutableStateFlow("")

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.USE_FREEDIUM),
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.DARK_MODE_ENABLED),
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.USE_CARD_LAYOUT, defaultValue = false),
        _jinaToken
    ) { useFreedium, darkTheme, useCardLayout, jinaToken ->
        SettingsState(
            useFreedium = useFreedium,
            darkTheme = darkTheme,
            useCardLayout = useCardLayout,
            jinaToken = jinaToken,
            jinaPlaceholder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here",
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = SettingsState(
            useFreedium = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM),
            darkTheme = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED),
            useCardLayout = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, false),
            jinaToken = "",
            jinaPlaceholder = sharedPreferencesManager.getString("JINA_TOKEN") ?: "Insert Jina Token Here",
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE
        )
    )

    override val state: StateFlow<SettingsState> = _state

    // Actions
    fun resetSemanticCache() {
        viewModelScope.launch(ioDispatcher) {
//            articleDao.clearModalTable()
            _event.emit(SettingsEvent.SemanticCacheCleared)
        }
    }

    fun updateJinaToken(token: String) {
        _jinaToken.value = token
    }

    fun updateJinaTokenPreferences() {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveString("JINA_TOKEN", _jinaToken.value)
            _event.emit(SettingsEvent.JinaTokenSaved)
        }
    }

    fun updatePreference(value: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.USE_FREEDIUM, value)
        }
    }

    fun updateDarkTheme(enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED, enabled)
        }
    }

    fun updateCardLayout(enabled: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, enabled)
        }
    }
}
