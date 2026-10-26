package com.jayteealao.trails.data

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SharedPreferencesManager @Inject constructor(
    @ApplicationContext private val context: Context
){
    companion object {
        const val PREFERENCES_NAME = "com.jayteealao.trails"
        const val PREFERENCES_KEY = "com.jayteealao.trails.key"
        const val LOCAL_DATA_OWNER_UID = "local_data_owner_uid"
        const val LOCAL_DATA_OWNER_LABEL = "local_data_owner_label"
    }

    private val sharedPreferences: SharedPreferences = context.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )

    fun saveString(key: String, value: String) {
        val editor = sharedPreferences.edit()
        editor.putString(key, value)
        editor.apply()
    }

    fun getString(key: String): String? {
        return sharedPreferences.getString(key, null)
    }

    fun getLong(key: String): Long? {
        return sharedPreferences.getLong(key, 0).takeIf { it != 0L }
    }

    fun saveLong(key: String, value: Long) {
        val editor = sharedPreferences.edit()
        editor.putLong(key, value)
        editor.apply()
    }

    fun saveBoolean(key: String, value: Boolean) {
        val editor = sharedPreferences.edit()
        editor.putBoolean(key, value)
        editor.apply()
    }

    fun getBoolean(key: String, defaultValue: Boolean = false): Boolean {
        return sharedPreferences.getBoolean(key, defaultValue)
    }

    fun preferenceChangesFlow(): Flow<String?> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { prefs, key ->
            trySend(key).isSuccess // Send the changed key
        }
        sharedPreferences.registerOnSharedPreferenceChangeListener(listener)
//        invokeOnClose {
//            sharedPreferences.unregisterOnSharedPreferenceChangeListener(listener)
//        }
        awaitClose { sharedPreferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    fun booleanFlow(key: String, defaultValue: Boolean = false): Flow<Boolean> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, changedKey ->
            if (changedKey == key) {
                trySend(getBoolean(key, defaultValue)).isSuccess
            }
        }
        trySend(getBoolean(key, defaultValue)).isSuccess
        sharedPreferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { sharedPreferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    /** The uid that owns the local library, or null when none is stored. */
    fun getLocalDataOwnerUid(): String? = sharedPreferences.getString(LOCAL_DATA_OWNER_UID, null)

    /** The owner's display label (the email; null for a guest). */
    fun getLocalDataOwnerLabel(): String? = sharedPreferences.getString(LOCAL_DATA_OWNER_LABEL, null)

    fun setLocalDataOwner(uid: String, label: String?) {
        sharedPreferences.edit().apply {
            putString(LOCAL_DATA_OWNER_UID, uid)
            if (label != null) putString(LOCAL_DATA_OWNER_LABEL, label) else remove(LOCAL_DATA_OWNER_LABEL)
        }.apply()
    }

    fun clearLocalDataOwner() {
        sharedPreferences.edit()
            .remove(LOCAL_DATA_OWNER_UID)
            .remove(LOCAL_DATA_OWNER_LABEL)
            .apply()
    }

    /**
     * Clear all preferences (the local data owner included)
     */
    fun clear() {
        val editor = sharedPreferences.edit()
        editor.clear()
        editor.apply()
    }
}

