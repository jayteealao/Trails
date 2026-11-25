package com.jayteealao.trails.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.jayteealao.trails.BuildConfig
import com.jayteealao.trails.data.LibraryLoad
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.Screen
import com.jayteealao.trails.screens.TrailScaffold
import com.jayteealao.trails.screens.TrailsTopAppBarNav3
import com.jayteealao.trails.screens.articleDetail.ArchiveRetryState
import com.jayteealao.trails.screens.articleDetail.ArticleDetailContent
import com.jayteealao.trails.screens.articleDetail.ArticleDetailState
import com.jayteealao.trails.screens.articleDetail.ArticleDetailTabRow
import com.jayteealao.trails.screens.articleDetail.READER_TAB_INDEX
import com.jayteealao.trails.screens.articleDetail.ReaderSignals
import com.jayteealao.trails.screens.articleDetail.WEB_TAB_INDEX
import com.jayteealao.trails.screens.articleDetail.WebFailure
import com.jayteealao.trails.screens.articleDetail.WebFailureKind
import com.jayteealao.trails.screens.articleDetail.WebTabNotice
import com.jayteealao.trails.screens.articleDetail.WebTabProgress
import com.jayteealao.trails.screens.articleDetail.archiveRowFor
import com.jayteealao.trails.screens.articleDetail.onTap
import com.jayteealao.trails.screens.articleDetail.readerBodyFor
import com.jayteealao.trails.screens.articleList.ArticleListFrame
import com.jayteealao.trails.screens.articleList.ArticleListScreenContent
import com.jayteealao.trails.screens.articleList.ArticleListState
import com.jayteealao.trails.screens.articleList.ArticleListTab
import com.jayteealao.trails.screens.articleList.actions.ArticleActionsSheet
import com.jayteealao.trails.screens.articleList.actions.ArticleSheet
import com.jayteealao.trails.screens.articleSearch.ArticleSearchContent
import com.jayteealao.trails.screens.articleSearch.ArticleSearchState
import com.jayteealao.trails.screens.auth.AuthUiState
import com.jayteealao.trails.screens.auth.SignInPanel
import com.jayteealao.trails.screens.auth.WORST_SIGN_IN_STATE
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.components.showDeleted
import com.jayteealao.trails.screens.components.showError
import com.jayteealao.trails.screens.settings.SettingsScreenContent
import com.jayteealao.trails.screens.settings.SettingsState
import com.jayteealao.trails.screens.share.SavePhase
import com.jayteealao.trails.screens.share.ShareSheet
import com.jayteealao.trails.screens.share.ShareState
import com.jayteealao.trails.services.firestore.SyncStatus
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import kotlinx.coroutines.flow.flowOf

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

/** Why the page of each held Web tab did not load; null while it loads. */
private val WEB_STATES: Map<String, WebFailure?> = mapOf(
    "web-empty" to WebFailure(WebFailureKind.OFFLINE, "https://example.org/trees"),
    "web-loading" to null,
    "web-error" to WebFailure(WebFailureKind.NO_ANSWER, "https://example.org/trees"),
    "web-worst" to WebFailure(
        WebFailureKind.CERTIFICATE, "https://reading-room.archive.the-longest-subdomain-in-the-list.example.org/a",
    ),
)

/** The Web tab with [failure], or with a page on its way; its buttons do nothing. */
@Composable
private fun WebStateScreen(failure: WebFailure?) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Box(Modifier.weight(1f)) {
            if (failure == null) {
                WebTabProgress(0.45f)
            } else {
                WebTabNotice(
                    failure = failure,
                    isArticlePage = true,
                    onRetry = {},
                    onOpenInBrowser = {},
                    onBack = {},
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        ArticleDetailTabRow(selectedTabIndex = WEB_TAB_INDEX)
    }
}

private const val LONG_TITLE = "Benachrichtigungseinstellungen and other compound words: how Aleksandra " +
    "Wiśniewska-Kowalczyk rebuilt a forty-year-old newsletter in one very long summer"

private val SAMPLE_ROWS = listOf(
    ArticleItem("tree-1", "Counting the street trees of a small city", "https://example.org/trees"),
    ArticleItem("tree-2", "A slow walk along the old canal", "https://example.com/canal", favorite = true),
    ArticleItem("tree-3", "What a newsletter keeps", "https://example.net/newsletter"),
)

private val WORST_ROWS = listOf(
    ArticleItem(
        itemId = "worst-1",
        title = LONG_TITLE,
        url = "https://reading-room.archive.the-longest-subdomain-in-the-list.example.org/a",
        favorite = true,
    ),
) + SAMPLE_ROWS

/** One held state of a list: its tab, its rows and their first load, and the library behind it. */
private data class ListFixture(
    val tab: ArticleListTab,
    val rows: List<ArticleItem> = emptyList(),
    val refresh: LoadState = LoadState.NotLoading(endOfPaginationReached = true),
    val library: LibraryState = LibraryState(hasArticles = false, signedIn = false),
    val failedChange: Boolean = false,
    val deleted: Boolean = false,
)

private val LOAD_FAILED = LoadState.Error(IllegalStateException("design state"))

private val LIST_STATES = mapOf(
    "home-default" to ListFixture(ArticleListTab.HOME, rows = SAMPLE_ROWS),
    "home-empty" to ListFixture(ArticleListTab.HOME),
    "home-loading" to ListFixture(ArticleListTab.HOME, refresh = LoadState.Loading),
    "home-error" to ListFixture(
        ArticleListTab.HOME,
        library = LibraryState(
            hasArticles = false, signedIn = true, load = LibraryLoad.Failed(offline = true, remoteCount = null),
        ),
    ),
    "home-worst" to ListFixture(
        ArticleListTab.HOME,
        library = LibraryState(
            hasArticles = false,
            signedIn = true,
            email = "aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org",
            load = LibraryLoad.Failed(offline = false, remoteCount = 1284),
        ),
    ),
    "favourites-default" to ListFixture(
        ArticleListTab.FAVOURITES, rows = SAMPLE_ROWS.map { it.copy(favorite = true) }, deleted = true,
    ),
    "favourites-empty" to ListFixture(ArticleListTab.FAVOURITES),
    "favourites-loading" to ListFixture(ArticleListTab.FAVOURITES, refresh = LoadState.Loading),
    "favourites-error" to ListFixture(ArticleListTab.FAVOURITES, refresh = LOAD_FAILED),
    "favourites-worst" to ListFixture(ArticleListTab.FAVOURITES, rows = WORST_ROWS, failedChange = true),
)

/** The actions sheet of each held state, over the sample list. */
private val ACTION_STATES = mapOf(
    "actions-default" to ArticleSheet(SAMPLE_ROWS[0]),
    "actions-empty" to ArticleSheet(ArticleItem("tree-0", "Notes from the tree survey", url = "")),
    "actions-loading" to ArticleSheet(SAMPLE_ROWS[0], regenerating = true),
    "actions-error" to ArticleSheet(
        SAMPLE_ROWS[0],
        failure = "Add to favourites was not saved on this phone. Choose it again to retry.",
    ),
    "actions-worst" to ArticleSheet(WORST_ROWS[0].copy(favorite = false)),
)

/** One held state of search: the words in the field and what the newest search found. */
private data class SearchFixture(val text: String, val state: ArticleSearchState)

private val SEARCH_STATES = mapOf(
    "search-default" to SearchFixture(
        "tree", ArticleSearchState(searchedQuery = "tree", searchResults = SAMPLE_ROWS.take(1)),
    ),
    "search-empty" to SearchFixture("zigurrat", ArticleSearchState(searchedQuery = "zigurrat")),
    "search-loading" to SearchFixture("tree", ArticleSearchState(searchedQuery = "tree", isSearching = true)),
    "search-error" to SearchFixture("tree", ArticleSearchState(searchedQuery = "tree", searchFailed = true)),
    "search-worst" to SearchFixture(
        LONG_TITLE, ArticleSearchState(searchedQuery = LONG_TITLE, searchResults = WORST_ROWS),
    ),
)

private val SHARE_SAVED = ShareState.Save(SAMPLE_ROWS[0].title, "example.org", SavePhase.SAVED)

/** The share sheet of each held state; its time never ends and its buttons do nothing. */
private val SHARE_STATES = mapOf(
    "share-default" to SHARE_SAVED,
    "share-empty" to ShareState.NoLink,
    "share-loading" to SHARE_SAVED.copy(phase = SavePhase.SAVING),
    "share-error" to SHARE_SAVED.copy(phase = SavePhase.NOT_SAVED),
    "share-worst" to ShareState.Save(
        LONG_TITLE, "reading-room.archive.the-longest-subdomain-in-the-list.example.org", SavePhase.ALREADY_SAVED,
    ),
)

/** The sign-in panel of each held state; its buttons do nothing. */
private val SIGN_IN_STATES = mapOf(
    "sign-in-default" to AuthUiState.SignedOut,
    "sign-in-empty" to AuthUiState.NoGoogleAccount,
    "sign-in-loading" to AuthUiState.Loading(),
    "sign-in-error" to AuthUiState.Error(ErrorMessage.GOOGLE_OFFLINE),
    "sign-in-worst" to WORST_SIGN_IN_STATE,
)

private val SETTINGS_DEFAULT = SettingsState(
    versionName = BuildConfig.VERSION_NAME,
    versionCode = BuildConfig.VERSION_CODE,
    userEmail = "mara@example.org",
)

private val SETTINGS_STATES = mapOf(
    "settings-default" to SETTINGS_DEFAULT,
    "settings-empty" to SETTINGS_DEFAULT.copy(theme = ThemeChoice.LIGHT, userEmail = null, isAnonymous = true),
    "settings-loading" to SETTINGS_DEFAULT.copy(isSyncing = true, syncStatus = SyncStatus.Syncing),
    "settings-error" to SETTINGS_DEFAULT.copy(syncStatus = SyncStatus.Error("Not synced", null)),
    "settings-worst" to SETTINGS_DEFAULT.copy(
        theme = ThemeChoice.DARK,
        userEmail = "aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org",
        syncStatus = SyncStatus.Error("Not synced", null),
    ),
)

/** The Settings screen over [state] in the app frame; its controls do nothing. */
@Composable
private fun SettingsStateScreen(state: SettingsState) {
    AppFrame(Screen.Settings) {
        SettingsScreenContent(viewStore = ViewStore { state })
    }
}

/** The app bar of [screen] over [content], as the app frames it. */
@Composable
private fun AppFrame(screen: Screen, content: @Composable () -> Unit) {
    TrailScaffold(
        topBar = { menuState ->
            TrailsTopAppBarNav3(
                title = "Trails",
                currentScreen = screen,
                menuState = menuState,
                onNavigateBack = {},
                onNavigateToSearch = {},
                onNavigateToSettings = {},
            )
        },
    ) { paddingValues, _, _ ->
        Box(Modifier.padding(paddingValues)) { content() }
    }
}

/** The list screen over [fixture], with the rules the app uses; its buttons do nothing. */
@Composable
private fun ListStateScreen(fixture: ListFixture) {
    val done = LoadState.NotLoading(endOfPaginationReached = true)
    val paging = remember(fixture) {
        flowOf(PagingData.from(fixture.rows, LoadStates(refresh = fixture.refresh, prepend = done, append = done)))
    }
    val state = ArticleListState(selectedTab = fixture.tab, library = fixture.library)
    val snackbarHostState = remember { SnackbarHostState() }
    if (fixture.failedChange) {
        // The message comes back each time it ends, so it can be captured at any time.
        LaunchedEffect(Unit) {
            while (true) snackbarHostState.showError(ErrorMessage.CHANGE_FAILED) {}
        }
    }
    if (fixture.deleted) {
        LaunchedEffect(Unit) {
            while (true) snackbarHostState.showDeleted {}
        }
    }
    AppFrame(Screen.ArticleList) {
        ArticleListFrame(
            selectedTab = fixture.tab,
            onSelectTab = {},
            syncing = false,
            snackbarHostState = snackbarHostState,
        ) {
            ArticleListScreenContent(
                lazyItems = paging.collectAsLazyPagingItems(),
                viewStore = ViewStore { state },
                onSelectArticle = {},
                onOpenTagManagement = {},
                useCardLayout = false,
            )
        }
    }
}

/** The search screen over [fixture]; its buttons do nothing. */
@Composable
private fun SearchStateScreen(fixture: SearchFixture) {
    AppFrame(Screen.ArticleSearch) {
        ArticleSearchContent(
            searchText = fixture.text,
            viewStore = ViewStore { fixture.state },
            onTextChange = {},
            onSearch = {},
            onClear = {},
            onSelectArticle = {},
            snackbarHostState = remember { SnackbarHostState() },
        )
    }
}

/**
 * Debug builds only: holds one state of Settings, its sync section, the unsynced-changes dialog,
 * the archive status of an article, the Web tab, a list or search on screen so it can be captured on a device or emulator.
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
 * The Web tab states are `web-empty` (offline) | `web-loading` | `web-error` | `web-worst` (a bad
 * certificate of a long host).
 *
 * The list states are `home-` and `favourites-` with `default` | `empty` | `loading` | `error` |
 * `worst`; the search states are `search-` with the same five. `favourites-default` holds the
 * message of a deleted article with Undo.
 *
 * The actions sheet states are `actions-` with the same five, over the sample list.
 *
 * The share sheet states are `share-` with the same five. The time of the sheet never ends; Close
 * and Back end the activity.
 *
 * The Settings states are `settings-` with the same five; `settings-worst` is always dark.
 * `settings-empty` is a guest, with the account upgrade row.
 *
 * The sign-in states are `sign-in-` with the same five: `empty` has no Google account on the
 * phone, `error` is offline, and `worst` names a long address.
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
        val dark = intent.getBooleanExtra(EXTRA_DARK, false) || state == "settings-worst"
        val fakeState = fixtureState(state, count, label, dark)

        setContent {
            TrailsTheme(darkTheme = dark) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val articleState = ARTICLE_STATES[state]
                    val listState = LIST_STATES[state]
                    val searchState = SEARCH_STATES[state]
                    val actionState = ACTION_STATES[state]
                    val shareState = SHARE_STATES[state]
                    val settingsState = SETTINGS_STATES[state]
                    val signInState = SIGN_IN_STATES[state]
                    when {
                        articleState != null -> ArticleStateScreen(articleState)
                        state in WEB_STATES -> WebStateScreen(WEB_STATES[state])
                        listState != null -> ListStateScreen(listState)
                        actionState != null -> {
                            ListStateScreen(LIST_STATES.getValue("home-default"))
                            ArticleActionsSheet(actionState, onChoose = {}, onDismiss = {})
                        }
                        shareState != null -> ShareSheet(
                            state = shareState,
                            onUndo = {},
                            onRetry = {},
                            onClosed = ::finish,
                            undoMillis = Long.MAX_VALUE,
                        )
                        searchState != null -> SearchStateScreen(searchState)
                        settingsState != null -> SettingsStateScreen(settingsState)
                        signInState != null -> SignInPanel(
                            state = signInState,
                            onGoogle = {},
                            onGuest = {},
                            onSkip = {},
                            onCancel = {},
                            onAddAccount = {},
                        )
                        else -> SettingsScreenContent(viewStore = ViewStore { fakeState })
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
                theme = if (dark) ThemeChoice.DARK else ThemeChoice.LIGHT,
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
