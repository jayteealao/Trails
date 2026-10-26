package com.jayteealao.trails.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.screens.settings.SettingsScreenContent
import com.jayteealao.trails.screens.settings.SettingsState
import com.jayteealao.trails.services.firestore.SyncStatus
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore

/**
 * Debug builds only: holds one state of the Settings sync section or the unsynced-changes
 * dialog on screen so it can be captured on a device or emulator.
 *
 * Extras: `state` (`pushing` | `push-failed` | `push-failed-one` | `push-failed-switch` |
 * `wiping` | `worst` | `failures` | `no-failures`), `count` (Int), `label` (String), `dark`
 * (Boolean). Every state renders the Settings screen behind it; `state` picks whether the
 * dialog or the failure row shows. Other extras are ignored.
 *
 * `adb shell am start -n com.jayteealao.trails/.debug.DesignStatesActivity
 *   --es state push-failed --ei count 42 --ez dark false`
 */
class DesignStatesActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val state = intent.getStringExtra(EXTRA_STATE) ?: "push-failed"
        val count = intent.getIntExtra(EXTRA_COUNT, -1)
        val label = intent.getStringExtra(EXTRA_LABEL)
        val dark = intent.getBooleanExtra(EXTRA_DARK, false)
        val fakeState = fixtureState(state, count, label, dark)

        setContent {
            TrailsTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    SettingsScreenContent(viewStore = ViewStore { fakeState })
                }
            }
        }
    }

    companion object {
        const val EXTRA_STATE = "state"
        const val EXTRA_COUNT = "count"
        const val EXTRA_LABEL = "label"
        const val EXTRA_DARK = "dark"

        /** The sample account the fixture states show. */
        const val SAMPLE_LABEL = "jo.reader@example.com"

        /** A long address, for the worst-case state at a large font scale. */
        const val WORST_LABEL =
            "aleksandra.wisniewska-kowalczyk.reading-archive+trails@mail.research.example.co.uk"

        private const val MINUTE_MS = 60_000L

        /**
         * The Settings state for one fixture state. `count` below 0 takes its sample count;
         * `label` null takes the sample account ("Guest account" needs `--es label ""`, which
         * is read as no label).
         */
        fun fixtureState(state: String, count: Int, label: String?, dark: Boolean): SettingsState {
            val ownerLabel = when (label) {
                null -> if (state == "worst") WORST_LABEL else SAMPLE_LABEL
                "" -> null
                else -> label
            }
            fun countOr(sample: Int) = if (count >= 0) count else sample

            val dialog = when (state) {
                "pushing" -> UnsyncedChangesDialogState.Pushing(countOr(42))
                "push-failed" -> UnsyncedChangesDialogState.PushFailed(
                    countOr(42), WipeReason.CLEAR_DATA, ownerLabel,
                )
                "push-failed-one" -> UnsyncedChangesDialogState.PushFailed(
                    1, WipeReason.CLEAR_DATA, ownerLabel,
                )
                "push-failed-switch" -> UnsyncedChangesDialogState.PushFailed(
                    countOr(3), WipeReason.ACCOUNT_SWITCH, ownerLabel,
                )
                "worst" -> UnsyncedChangesDialogState.PushFailed(
                    countOr(1000), WipeReason.ACCOUNT_SWITCH, ownerLabel,
                )
                "wiping" -> UnsyncedChangesDialogState.Wiping
                else -> UnsyncedChangesDialogState.Hidden
            }
            val failures = when (state) {
                "failures" -> countOr(2)
                else -> 0
            }
            val lastSyncAgo = if (state == "failures") 12 * MINUTE_MS else 2 * MINUTE_MS

            return SettingsState(
                darkTheme = dark,
                useCardLayout = true,
                versionName = BuildConfig.VERSION_NAME,
                versionCode = BuildConfig.VERSION_CODE,
                lastSyncTime = System.currentTimeMillis() - lastSyncAgo,
                syncStatus = SyncStatus.Idle,
                userEmail = SAMPLE_LABEL,
                isAnonymous = false,
                syncFailureCount = failures,
                unsyncedChangesDialog = dialog,
            )
        }
    }
}
