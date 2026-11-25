@file:OptIn(ExperimentalMaterial3Api::class)

package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.res.Configuration
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SecondaryScrollableTabRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.constraintlayout.compose.ConstraintLayout
import androidx.constraintlayout.compose.Dimension
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.WebContent
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.components.openInBrowser
import com.jayteealao.trails.screens.components.showError
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.Markdown
import com.mikepenz.markdown.m3.markdownColor
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * The article of [articleId] and its messages. The messages show with or without a loaded article,
 * so an article that does not open says so and offers Try again.
 */
@Composable
fun ArticleDetailPane(
    articleId: String,
    viewModel: ArticleDetailViewModel = hiltViewModel(),
    modifier: Modifier = Modifier,
) {
    val viewStore = rememberViewStore { viewModel }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    viewStore.handle<ArticleDetailEvent.ShowError> { event ->
        scope.launch { snackbarHostState.showError(event.message, event.retry) }
    }

    viewStore.handle<ArticleDetailEvent.ShowToast> { event ->
        scope.launch { snackbarHostState.showSnackbar(event.message) }
    }

    LaunchedEffect(articleId) {
        // A message of the article before this one has nothing left to retry here.
        snackbarHostState.currentSnackbarData?.dismiss()
        viewModel.getArticle(articleId)
    }

    Box(modifier.fillMaxSize()) {
        val article = viewStore.state.article
        if (article == null) {
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .windowInsetsPadding(WindowInsets.navigationBars),
            )
        } else {
            ArticleDetailScreen(
                article = article,
                viewStore = viewStore,
                snackbarHost = { SnackbarHost(snackbarHostState) },
                onOpenInBrowser = { url ->
                    try {
                        context.openInBrowser(url)
                    } catch (e: ActivityNotFoundException) {
                        Timber.w(e, "No browser on this device")
                        scope.launch { snackbarHostState.showError(ErrorMessage.NO_BROWSER, retry = null) }
                    }
                },
            )
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleDetailScreen(
    article: Article,
    viewStore: ViewStore<ArticleDetailState, ArticleDetailEvent, ArticleDetailViewModel> = rememberViewStore { hiltViewModel() },
    snackbarHost: @Composable () -> Unit = {},
    onOpenInBrowser: (String) -> Unit = {},
) {
    // Mark as read when screen opens (article loading handled by ArticleDetailPane)
    LaunchedEffect(article.itemId) {
        viewStore.action {
            markAsRead(article.itemId)
        }
    }

    val currentArticle = viewStore.state.article ?: article
    ArticleDetailContent(
        state = viewStore.state,
        article = currentArticle,
        onTabSelected = { viewStore.action { setSelectedTab(it) } },
        onRetry = { viewStore.action { retryArchive(currentArticle.itemId) } },
        snackbarHost = snackbarHost,
        onOpenInBrowser = onOpenInBrowser,
    )
}

/**
 * The article screen without its view model: the selected tab's body, then the archive status row
 * when there is one, then the tab row. The row is a sibling of the body, so it never covers text.
 * The messages of [snackbarHost] lie over the body, above the row and the tabs.
 */
@Composable
fun ArticleDetailContent(
    state: ArticleDetailState,
    article: Article,
    onTabSelected: (Int) -> Unit,
    onRetry: () -> Unit,
    snackbarHost: @Composable () -> Unit = {},
    onOpenInBrowser: (String) -> Unit = {},
) {
    val tabs = detailTabsFor(state.tabArchiveKeys)

    ConstraintLayout(
        modifier = Modifier.fillMaxSize()
    ) {
        val (bottomRows, detailView, messages) = createRefs()

        ArticleDetails(
            modifier = Modifier.constrainAs(detailView) {
                top.linkTo(parent.top)
                bottom.linkTo(bottomRows.top)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
                height = Dimension.fillToConstraints
            },
            selectedTabIndex = state.selectedTabIndex,
            article = article,
            tabs = tabs,
            selectedArchiveContent = state.selectedArchiveContent,
            readerBody = state.readerBody,
            selectedArchiveLoadFailed = state.selectedArchiveLoadFailed,
            pendingArchiveKeys = state.pendingArchiveKeys,
            failedArchiveKeys = state.failedArchiveKeys,
            online = state.online,
            onRetry = onRetry,
            onOpenInBrowser = onOpenInBrowser,
        )

        Column(
            modifier = Modifier.constrainAs(bottomRows) {
                bottom.linkTo(parent.bottom)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
        ) {
            state.archiveRow?.let { ArchiveStatusRow(row = it, onRetry = onRetry) }
            ArticleDetailTabRow(
                selectedTabIndex = state.selectedTabIndex,
                tabs = tabs,
                onTabSelected = onTabSelected,
            )
        }

        Box(
            modifier = Modifier.constrainAs(messages) {
                bottom.linkTo(bottomRows.top)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
        ) {
            snackbarHost()
        }
    }
}

@Preview(name = "Article Detail • archive failed • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ArticleDetailArchiveFailedLightPreview() {
    ArticleDetailRowPreview("failed")
}

@Preview(
    name = "Article Detail • archive failed • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 900,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleDetailArchiveFailedDarkPreview() {
    ArticleDetailRowPreview("failed", darkTheme = true)
}

@Preview(name = "Article Detail • archiving • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ArticleDetailArchivingPreview() {
    ArticleDetailRowPreview("processing")
}

@Composable
private fun ArticleDetailRowPreview(status: String, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            ArticleDetailContent(
                state = ArticleDetailState(
                    selectedTabIndex = READER_TAB_INDEX,
                    readerBody = ReaderBody.Text,
                    archiveRow = archiveRowFor(hasText = true, status = status, retry = ArchiveRetryState.Idle),
                ),
                article = PreviewFixtures.article.copy(text = PREVIEW_READER_MARKDOWN),
                onTabSelected = {},
                onRetry = {},
            )
        }
    }
}

@Preview(name = "Article Detail • Reader", showBackground = true)
@Composable
private fun ArticleDetailScreenReaderPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleDetailScreen(
            article = PreviewFixtures.article,
            viewStore = ViewStore {
                ArticleDetailState(
                    article = PreviewFixtures.article,
                    selectedTabIndex = 1
                )
            }
        )
    }
}

@Preview(name = "Article Detail • Markdown", showBackground = true)
@Composable
private fun ArticleDetailMarkdownPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleDetails(
            selectedTabIndex = 0,
            article = PreviewFixtures.article,
        )
    }
}

@Preview(
    name = "Article Detail • Archive Tabs",
    showBackground = true,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleDetailArchivePreview() {
    TrailsTheme(darkTheme = true) {
        ArticleDetails(
            selectedTabIndex = 2,
            article = PreviewFixtures.article,
            tabs = detailTabsFor(listOf("singlefile", "readability")),
            selectedArchiveContent = "<h1>Archived Content</h1><p>This is archived HTML.</p>",
        )
    }
}

/** The reading column on a phone: the reading heading scale, a 16 dp gutter, a broken image. */
@Preview(name = "Reader text • phone • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ArticleMarkdownPhoneLightPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleMarkdown(PREVIEW_READER_MARKDOWN)
    }
}

@Preview(
    name = "Reader text • phone • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 900,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleMarkdownPhoneDarkPreview() {
    TrailsTheme(darkTheme = true) {
        ArticleMarkdown(PREVIEW_READER_MARKDOWN)
    }
}

/** On a tablet the column stops at 680 dp and is centred. */
@Preview(name = "Reader text • tablet • light", showBackground = true, widthDp = 900, heightDp = 900)
@Composable
private fun ArticleMarkdownTabletPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleMarkdown(PREVIEW_READER_MARKDOWN)
    }
}

// Synthetic sample text, written for the previews; not from a real site. The image link uses a
// reserved domain that never resolves, so the broken-image placeholder draws.
private val PREVIEW_READER_MARKDOWN = """
    # Counting the street trees of a small city

    *By Mara Ellison*

    The survey began with a question nobody at the council could answer: how many trees line our streets?

    ## How the count worked

    Forty volunteers split the city into 212 blocks. Each pair walked one block an evening.

    ![A map of the 212 survey blocks](https://images.example.invalid/street-trees/survey-blocks-map.png)

    - 212 blocks, two walkers each
    - Trunk girth at chest height
    - Species, bark state and verge width

    ### Planting from the survey

    The council now plants 300 trees a year, chosen from the survey. The spreadsheet is on the [council's open data page](https://data.example.org/street-trees).
""".trimIndent()

/** Every tab of an article with all six local archives, the AI Markdown tab selected. */
@Preview(name = "Tab row • all tabs • light", showBackground = true, widthDp = 375)
@Composable
private fun ArticleDetailTabRowLightPreview() {
    TrailsTheme(darkTheme = false) {
        ArticleDetailTabRow(selectedTabIndex = 3, tabs = detailTabsFor(PREVIEW_ALL_ARCHIVE_KEYS))
    }
}

@Preview(
    name = "Tab row • all tabs • dark",
    showBackground = true,
    widthDp = 375,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ArticleDetailTabRowDarkPreview() {
    TrailsTheme(darkTheme = true) {
        ArticleDetailTabRow(selectedTabIndex = 3, tabs = detailTabsFor(PREVIEW_ALL_ARCHIVE_KEYS))
    }
}

private val PREVIEW_ALL_ARCHIVE_KEYS =
    listOf("singlefile", "monolith", "readability", "markdown", "rendered", "ai_markdown")

/** A Reader body on the theme's background, as the article screen draws it. */
@Composable
private fun ReaderBodyPreview(body: ReaderBody, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            ReaderBodyView(body = body, text = "", onRetry = {})
        }
    }
}

@Preview(name = "Reader notice • waiting • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderWaitingLightPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.WAITING))
}

@Preview(
    name = "Reader notice • waiting • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 900,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ReaderWaitingDarkPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.WAITING), darkTheme = true)
}

@Preview(name = "Reader notice • offline • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderOfflinePreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.OFFLINE))
}

@Preview(name = "Reader notice • failed • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderFailedLightPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.FAILED))
}

@Preview(
    name = "Reader notice • failed • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 900,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ReaderFailedDarkPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.FAILED), darkTheme = true)
}

@Preview(name = "Reader notice • no text • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderNoTextPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.NO_TEXT))
}

@Preview(name = "Text tab notice • empty • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderEmptyPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.EMPTY))
}

@Preview(name = "Text tab notice • could not be opened • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderUnreadablePreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.UNREADABLE))
}

@Preview(name = "Reader skeleton • light", showBackground = true, widthDp = 411, heightDp = 900)
@Composable
private fun ReaderSkeletonLightPreview() {
    ReaderBodyPreview(ReaderBody.Loading)
}

@Preview(
    name = "Reader skeleton • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 900,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ReaderSkeletonDarkPreview() {
    ReaderBodyPreview(ReaderBody.Loading, darkTheme = true)
}

/** At twice the font size the notice scrolls rather than hiding its line. */
@Preview(name = "Reader notice • failed • large font", showBackground = true, widthDp = 411, heightDp = 600, fontScale = 2f)
@Composable
private fun ReaderFailedLargeFontPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.FAILED))
}

/** On a tablet the notice stays centred in the 680 dp reading column. */
@Preview(name = "Reader notice • waiting • tablet", showBackground = true, widthDp = 900, heightDp = 900)
@Composable
private fun ReaderWaitingTabletPreview() {
    ReaderBodyPreview(ReaderBody.Notice(ReaderNoticeKind.WAITING))
}

/**
 * The bottom row of the article detail screen: one labelled tab per entry of [tabs], on the
 * surface with a hairline above. It scrolls when the tabs do not fit; the selected tab is in
 * the accent with a 3 dp underline.
 */
@Composable
fun ArticleDetailTabRow(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = WEB_TAB_INDEX,
    tabs: List<DetailTab> = detailTabsFor(emptyList()),
    onTabSelected: (Int) -> Unit = {}
) {
    val colors = MaterialTheme.colorScheme
    Column(modifier = modifier.windowInsetsPadding(WindowInsets.navigationBars)) {
        HorizontalDivider(thickness = Dp.Hairline, color = colors.outlineVariant)
        SecondaryScrollableTabRow(
            selectedTabIndex = selectedTabIndex,
            containerColor = colors.surface,
            contentColor = colors.onSurfaceVariant,
            edgePadding = 16.dp,
            minTabWidth = 90.dp,
            indicator = {
                TabRowDefaults.SecondaryIndicator(
                    modifier = Modifier
                        .tabIndicatorOffset(selectedTabIndex, matchContentSize = false)
                        .clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)),
                    height = 3.dp,
                    color = colors.primary,
                )
            },
            divider = {},
        ) {
            tabs.forEachIndexed { index, tab ->
                ArticleDetailTab(
                    tab = tab,
                    selected = selectedTabIndex == index,
                    onClick = { onTabSelected(index) },
                )
            }
        }
    }
}

/** One tab: a 24 dp outline icon over a one-line label; the label is the tab's accessible name. */
@Composable
private fun ArticleDetailTab(tab: DetailTab, selected: Boolean, onClick: () -> Unit) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.height(64.dp),
        selectedContentColor = MaterialTheme.colorScheme.primary,
        unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Icon(tab.icon, contentDescription = null, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(2.dp))
        Text(
            text = tab.label,
            style = MaterialTheme.typography.labelMedium.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
fun ArticleDetails(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = 1,
    article: Article,
    tabs: List<DetailTab> = detailTabsFor(emptyList()),
    selectedArchiveContent: String? = null,
    readerBody: ReaderBody = ReaderBody.Loading,
    selectedArchiveLoadFailed: Boolean = false,
    pendingArchiveKeys: Set<String> = emptySet(),
    failedArchiveKeys: Set<String> = emptySet(),
    online: Boolean = true,
    onRetry: (() -> Unit)? = null,
    onOpenInBrowser: (String) -> Unit = {},
) {
    AnimatedContent(
        targetState = selectedTabIndex,
        modifier = modifier
    ) { targetIndex ->
        when {
            targetIndex == 0 -> ReaderBodyView(
                body = if (!article.text.isNullOrBlank()) ReaderBody.Text else readerBody,
                text = article.text.orEmpty(),
                onRetry = onRetry,
            )
            targetIndex == 1 -> ArticleWebView(
                url = article.url ?: article.givenUrl ?: "https://www.google.com/",
                online = online,
                onOpenInBrowser = onOpenInBrowser,
            )
            else -> {
                val archiveType = tabs.getOrNull(targetIndex)?.archiveType
                if (archiveType != null) {
                    if (archiveType.archiveKey in pendingArchiveKeys) {
                        // The archive is still on its way to the phone.
                        ReaderBodyView(
                            body = pendingArchiveBodyFor(
                                downloadFailed = archiveType.archiveKey in failedArchiveKeys,
                                online = online,
                            ),
                            text = "",
                        )
                    } else if (archiveType.providesText) {
                        ReaderBodyView(
                            body = archiveTabBodyFor(selectedArchiveContent, selectedArchiveLoadFailed),
                            text = selectedArchiveContent.orEmpty(),
                        )
                    } else {
                        ArticleArchiveWebView(selectedArchiveContent ?: "")
                    }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleArchiveWebView(
    htmlContent: String,
    modifier: Modifier = Modifier,
) {
    val webViewState = rememberWebViewState(url = "about:blank")

    // Reactively update WebView content when htmlContent changes
    LaunchedEffect(htmlContent) {
        if (htmlContent.isNotEmpty()) {
            webViewState.content = WebContent.Data(
                data = htmlContent,
                mimeType = "text/html",
                encoding = "UTF-8",
            )
        }
    }

    Column(modifier = modifier) {
        WebView(
            state = webViewState,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(),
            onCreated = { webView ->
                webView.settings.javaScriptEnabled = true
                webView.settings.domStorageEnabled = true
            },
            client = remember { AccompanistWebViewClient() }
        )
    }
}

/**
 * The reader text: Markdown in the reading column, with the reading heading scale, a 16 dp
 * gutter, a 680 dp centred width and the broken-image placeholder. A leading front matter
 * block is not drawn ([withoutFrontMatter]).
 */
@Composable
fun ArticleMarkdown(
    content: String,
    modifier: Modifier = Modifier
) {
    val body = remember(content) { withoutFrontMatter(content) }
    Markdown(
        content = body,
        modifier = modifier.fillMaxSize(),
        colors = markdownColor(),
        typography = readerMarkdownTypography(),
        padding = readerMarkdownPadding(),
        imageTransformer = Coil3ImageTransformerImpl,
        components = readerMarkdownComponents(),
        success = { state, components, columnModifier -> ReaderColumn(state, components, columnModifier) },
    )
}
