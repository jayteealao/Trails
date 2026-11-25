package com.jayteealao.trails.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState
import com.jayteealao.trails.screens.articleDetail.ArticleDetailContent
import com.jayteealao.trails.screens.articleDetail.ArticleDetailState
import com.jayteealao.trails.screens.articleDetail.READER_TAB_INDEX
import com.jayteealao.trails.screens.articleDetail.ReaderSignals
import com.jayteealao.trails.screens.articleDetail.archiveRowFor
import com.jayteealao.trails.screens.articleDetail.onTap
import com.jayteealao.trails.screens.articleDetail.readerBodyFor
import com.jayteealao.trails.screens.settings.SettingsScreenContent
import com.jayteealao.trails.screens.settings.SettingsState
import com.jayteealao.trails.services.firestore.SyncStatus
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore

/** One held state of the article screen: its stored text, its archive status and its retry. */
private data class ArticleFixture(
    val status: String,
    val text: String? = SAMPLE_TEXT,
    val retry: ArchiveRetryState = ArchiveRetryState.Idle,
)

// Synthetic sample text; not from a real site.
private const val SAMPLE_BODY = """*By Mara Ellison*

The survey began with a question nobody at the council could answer: how many trees line our streets? The last count was a typed list from 1987, and half of the streets on it had new names.

Forty volunteers split the city into 212 blocks. Each pair walked one block an evening, measured the trunk of every tree at chest height and noted the species, the state of the bark and the width of the verge.

## What the trees showed

By the end of the first summer they had 6,400 trees on paper. Lime and plane made up more than half."""

private const val SAMPLE_TEXT = "# Counting the street trees of a small city\n\n$SAMPLE_BODY"

private const val WORST_TEXT = "# Benachrichtigungseinstellungen and other compound words: how Aleksandra " +
    "Wiśniewska-Kowalczyk rebuilt a forty-year-old newsletter in one very long summer\n\n$SAMPLE_BODY"

private val ARTICLE_STATES = mapOf(
    "reader-processing" to ArticleFixture("processing"),
    "reader-complete" to ArticleFixture("complete"),
    "reader-failed" to ArticleFixture("failed"),
    "reader-retrying" to ArticleFixture("failed", retry = ArchiveRetryState.Sending()),
    "reader-not-sent" to ArticleFixture("failed", retry = ArchiveRetryState.NotSent(RetryFailure.REFUSED)),
    "reader-worst" to ArticleFixture(
        "failed", text = WORST_TEXT, retry = ArchiveRetryState.NotSent(RetryFailure.OFFLINE),
    ),
    "notice-failed" to ArticleFixture("failed", text = null),
    "notice-not-sent" to ArticleFixture(
        "failed", text = null, retry = ArchiveRetryState.NotSent(RetryFailure.OFFLINE),
    ),
)

/** The article screen over [fixture], with the rules the app uses and a retry that never answers. */
@Composable
private fun ArticleStateScreen(fixture: ArticleFixture) {
    var retry by remember { mutableStateOf(fixture.retry) }
    var tab by remember { mutableIntStateOf(READER_TAB_INDEX) }
    val hasText = fixture.text != null
    Box(Modifier.fillMaxSize().statusBarsPadding()) {
        ArticleDetailContent(
            state = ArticleDetailState(
                selectedTabIndex = tab,
                articleStatus = fixture.status,
                readerBody = readerBodyFor(
                    ReaderSignals(
                        hasText = hasText,
                        loaded = true,
                        online = true,
                        articleStatus = fixture.status,
                        retry = retry,
                    ),
                ),
                archiveRow = archiveRowFor(hasText, fixture.status, retry),
            ),
            article = Article(
                itemId = "design-state",
                url = "https://example.com",
                givenUrl = "https://example.com",
                text = fixture.text,
            ),
            onTabSelected = { tab = it },
            onRetry = { retry = retry.onTap(fixture.status) },
        )
    }
}

/**
 * Debug builds only: holds one state of the Settings sync section, the unsynced-changes dialog
 * or the archive status of an article on screen so it can be captured on a device or emulator.
 *
 * Extras: `state` (`pushing` | `push-failed` | `push-failed-one` | `push-failed-switch` |
 * `wiping` | `worst` | `failures` | `retry-failed` | `no-failures`), `count` (Int), `label`
 * (String), `dark` (Boolean). Every state renders the Settings screen behind it; `state` picks
 * whether the dialog or the failure row shows. `retry-failed` is the row after a Retry that did
 * not finish cleanly. The switch states (`push-failed-switch`, `worst`) show the back-up hint
 * when they have a label; `--es label ""` gives the guest owner, with no hint. Other extras are
 * ignored.
 *
 * The article states show the Reader tab with sample text (`reader-processing` |
 * `reader-complete` | `reader-failed` | `reader-retrying` | `reader-not-sent` | `reader-worst`) or
 * without text (`notice-failed` | `notice-not-sent`). A tap on Try again stays at the request that
 * never answers.
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
                    val articleState = ARTICLE_STATES[state]
                    if (articleState != null) {
                        ArticleStateScreen(articleState)
                    } else {
                        SettingsScreenContent(viewStore = ViewStore { fakeState })
                    }
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
                "failures", "retry-failed" -> countOr(2)
                else -> 0
            }
            val lastSyncAgo = if (failures > 0) 12 * MINUTE_MS else 2 * MINUTE_MS

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
                retryFailed = state == "retry-failed",
                unsyncedChangesDialog = dialog,
            )
        }
    }
}
