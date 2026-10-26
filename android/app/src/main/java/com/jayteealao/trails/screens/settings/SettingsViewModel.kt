package com.jayteealao.trails.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.data.account.PushThenWipeResult
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import com.jayteealao.trails.services.firestore.SyncFailures
import com.jayteealao.trails.services.firestore.SyncRunStatus
import com.jayteealao.trails.services.firestore.SyncStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

// Internal data classes for grouping flow state
private data class PreferencesState(
    val useFreedium: Boolean,
    val darkTheme: Boolean,
    val useCardLayout: Boolean
)

private data class SyncStateData(
    val isSyncing: Boolean,
    val lastSyncTime: Long,
    val syncStatus: SyncStatus,
    val lastError: String?
)

private data class LocalDataStateData(
    val syncFailureCount: Int,
    val isRetryingFailures: Boolean,
    val unsyncedChangesDialog: UnsyncedChangesDialogState,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val syncFailures: SyncFailures,
    private val sharedPreferencesManager: SharedPreferencesManager,
    private val firestoreSyncManager: FirestoreSyncManager,
    private val authRepository: com.jayteealao.trails.data.AuthRepository,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher,
    private val pushThenWipe: PushThenWipe,
    private val localDataOwner: LocalDataOwner,
): ViewModel(), Store<SettingsState, SettingsEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<SettingsEvent>()
    override val event: SharedFlow<SettingsEvent> = _event.asSharedFlow()

    // Tartlet Store implementation - Consolidated state
    // Combine preferences flows
    private val preferencesFlow = combine(
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.USE_FREEDIUM),
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.DARK_MODE_ENABLED),
        sharedPreferencesManager.booleanFlow(SettingsPreferenceKeys.USE_CARD_LAYOUT, defaultValue = false),
    ) { useFreedium, darkTheme, useCardLayout ->
        PreferencesState(useFreedium, darkTheme, useCardLayout)
    }

    // Combine sync state flows
    private val syncStateFlow = combine(
        firestoreSyncManager.isSyncing,
        firestoreSyncManager.lastSyncTime,
        firestoreSyncManager.syncStatus,
        firestoreSyncManager.lastError
    ) { isSyncing, lastSyncTime, syncStatus, lastError ->
        SyncStateData(isSyncing, lastSyncTime, syncStatus, lastError)
    }

    /** The failure count when Retry was tapped, while that retry runs; null otherwise. */
    private val retryingFailureCount = MutableStateFlow<Int?>(null)
    private val unsyncedChangesDialog =
        MutableStateFlow<UnsyncedChangesDialogState>(UnsyncedChangesDialogState.Hidden)

    // The retry resets the counters first, so the row keeps the tapped count while it runs.
    private val localDataStateFlow = combine(
        syncFailures.observeCount(),
        retryingFailureCount,
        unsyncedChangesDialog,
    ) { failureCount, retryingCount, dialog ->
        LocalDataStateData(retryingCount ?: failureCount, retryingCount != null, dialog)
    }

    /** The "Clear data" run, so Cancel can stop it while pending changes are pushed. */
    private var clearDataJob: Job? = null

    /** The manual "Sync now" run; "Clear data" cancels it before it pushes and wipes. */
    private var manualSyncJob: Job? = null

    /** The person's answer to the push-failed dialog: true clears the device. */
    private var clearAnswer: CompletableDeferred<Boolean>? = null

    // Combine all groups into final state
    private val _state = combine(
        preferencesFlow,
        syncStateFlow,
        localDataStateFlow,
    ) { prefs, sync, local ->
        val currentUser = authRepository.getCurrentUser()
        SettingsState(
            useFreedium = prefs.useFreedium,
            darkTheme = prefs.darkTheme,
            useCardLayout = prefs.useCardLayout,
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            isSyncing = sync.isSyncing,
            lastSyncTime = sync.lastSyncTime,
            syncStatus = sync.syncStatus,
            lastError = sync.lastError,
            userEmail = currentUser?.email,
            isAnonymous = currentUser?.isAnonymous ?: false,
            syncFailureCount = local.syncFailureCount,
            isRetryingFailures = local.isRetryingFailures,
            unsyncedChangesDialog = local.unsyncedChangesDialog,
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = SettingsState(
            useFreedium = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM),
            darkTheme = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED),
            useCardLayout = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, false),
            versionName = BuildConfig.VERSION_NAME,
            versionCode = BuildConfig.VERSION_CODE,
            userEmail = authRepository.getCurrentUser()?.email,
            isAnonymous = authRepository.getCurrentUser()?.isAnonymous ?: false
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

    fun performManualSync() {
        // No sync while the local data is being cleared.
        if (unsyncedChangesDialog.value != UnsyncedChangesDialogState.Hidden) return
        manualSyncJob = viewModelScope.launch(ioDispatcher) {
            try {
                firestoreSyncManager.performFullSync()
                _event.emit(SettingsEvent.SyncCompleted)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _event.emit(SettingsEvent.ShowToast("Sync failed: ${e.message}"))
            }
        }
    }

    /**
     * "Logout only" ([clearData] false) keeps every table and the archive folder.
     * "Clear data" pushes pending changes first (at most 15 seconds), then clears every
     * table and the archive folder; when changes stay unsent the person decides, and
     * keeping the data leaves them signed in with nothing changed.
     */
    fun logout(clearData: Boolean = false) {
        if (!clearData) {
            viewModelScope.launch(ioDispatcher) {
                authRepository.signOut()
                _event.emit(SettingsEvent.LoggedOut)
            }
            return
        }
        if (clearDataJob?.isActive == true) return
        manualSyncJob?.cancel()
        clearDataJob = viewModelScope.launch(ioDispatcher) {
            try {
                clearData()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A failed wipe, preferences clear or sign-out must not end the app; the
                // person is told and can try again.
                unsyncedChangesDialog.value = UnsyncedChangesDialogState.Hidden
                _event.emit(SettingsEvent.ShowToast("Clear data failed: ${e.message}"))
            }
        }
    }

    private suspend fun clearData() {
        val user = authRepository.getCurrentUser()
        val result = pushThenWipe.run(
            reason = WipeReason.CLEAR_DATA,
            ownerLabel = localDataOwner.label(),
            canPush = user != null && localDataOwner.isOwnedBy(user.uid),
            onState = { unsyncedChangesDialog.value = it },
            confirm = {
                val answer = CompletableDeferred<Boolean>()
                clearAnswer = answer
                try {
                    answer.await()
                } finally {
                    clearAnswer = null
                }
            },
        )
        if (result == PushThenWipeResult.WIPED) {
            // Also clears the owner, so the next sign-in takes the empty device.
            sharedPreferencesManager.clear()
            authRepository.signOut()
            _event.emit(SettingsEvent.LoggedOut)
        }
    }

    /** Cancel while pending changes are pushed: nothing is cleared. */
    fun cancelUnsyncedPush() {
        if (unsyncedChangesDialog.value is UnsyncedChangesDialogState.Pushing) clearDataJob?.cancel()
    }

    fun keepLocalData() {
        clearAnswer?.complete(false)
    }

    fun clearAnyway() {
        clearAnswer?.complete(true)
    }

    /** Retry on the failure row: reset the 3-strike counters, then push once. */
    fun retrySyncFailures() {
        if (retryingFailureCount.value != null) return
        retryingFailureCount.value = state.value.syncFailureCount
        viewModelScope.launch(ioDispatcher) {
            try {
                if (syncFailures.retry().status != SyncRunStatus.SUCCESS) {
                    _event.emit(SettingsEvent.ShowToast(RETRY_FAILED_MESSAGE))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _event.emit(SettingsEvent.ShowToast(RETRY_FAILED_MESSAGE))
            } finally {
                retryingFailureCount.value = null
            }
        }
    }

    private companion object {
        const val RETRY_FAILED_MESSAGE = "Retry failed. These articles will be tried again on the next sync."
    }
}
