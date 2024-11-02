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
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val pocketDao: PocketDao,
    private val sharedPreferencesManager: SharedPreferencesManager,
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

    val preferenceFlow = sharedPreferencesManager.preferenceChangesFlow()
        .filter {
            it == "USE_FREEDIUM"
        }.map {
            Timber.d("Preference changed: $it")
            sharedPreferencesManager.getBoolean(it!!)
        }.stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean("USE_FREEDIUM")
        )

    fun updatePreference(value: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            sharedPreferencesManager.saveBoolean("USE_FREEDIUM", value)
        }
    }
}