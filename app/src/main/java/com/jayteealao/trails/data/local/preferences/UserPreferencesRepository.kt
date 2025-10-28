package com.jayteealao.trails.data.local.preferences

import com.jayteealao.trails.data.SharedPreferencesManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferencesRepository @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager
) {
    companion object {
        private const val CONTROL_DISPLAY_METHOD = "control_display_method"
    }

    val controlDisplayMethod: Flow<ControlDisplayMethod> =
        sharedPreferencesManager.preferenceChangesFlow()
            .map {
                val methodName = sharedPreferencesManager.getString(CONTROL_DISPLAY_METHOD)
                    ?: ControlDisplayMethod.MENU.name
                try {
                    ControlDisplayMethod.valueOf(methodName)
                } catch (e: IllegalArgumentException) {
                    ControlDisplayMethod.MENU
                }
            }

    fun setControlDisplayMethod(method: ControlDisplayMethod) {
        sharedPreferencesManager.saveString(CONTROL_DISPLAY_METHOD, method.name)
    }

    fun getControlDisplayMethod(): ControlDisplayMethod {
        val methodName = sharedPreferencesManager.getString(CONTROL_DISPLAY_METHOD)
            ?: ControlDisplayMethod.MENU.name
        return try {
            ControlDisplayMethod.valueOf(methodName)
        } catch (e: IllegalArgumentException) {
            ControlDisplayMethod.MENU
        }
    }
}