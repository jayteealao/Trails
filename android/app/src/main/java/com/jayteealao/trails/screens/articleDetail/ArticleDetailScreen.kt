@file:OptIn(ExperimentalMaterial3Api::class)

package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import android.content.res.Configuration
import androidx.compose.animation.AnimatedContent
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SecondaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.constraintlayout.compose.ConstraintLayout
import androidx.constraintlayout.compose.Dimension
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebContent
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.Markdown
import com.mikepenz.markdown.m3.markdownColor
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleDetailScreen(
    article: Article,
    viewStore: ViewStore<ArticleDetailState, ArticleDetailEvent, ArticleDetailViewModel> = rememberViewStore { hiltViewModel() }
) {
    // Mark as read when screen opens (article loading handled by MainNavigation)
    LaunchedEffect(article.itemId) {
        viewStore.action {
            markAsRead(article.itemId)
        }
    }

    // Handle events
    viewStore.handle<ArticleDetailEvent.ArticleMarkedAsRead> { event ->
        // Could show a subtle indicator that article was marked as read
    }

    viewStore.handle<ArticleDetailEvent.ShowError> { event ->
        // Could show error toast/snackbar
    }

    viewStore.handle<ArticleDetailEvent.ShowToast> { event ->
        // Show toast message
    }

    val currentArticle = viewStore.state.article ?: article
    val tabs = detailTabsFor(viewStore.state.localArchives.map { it.archiveKey })

    ConstraintLayout(
        modifier = Modifier.fillMaxSize()
    ) {
        val (tabRow, detailView) = createRefs()

        ArticleDetails(
            modifier = Modifier.constrainAs(detailView) {
                top.linkTo(parent.top)
                bottom.linkTo(tabRow.top)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
                height = Dimension.fillToConstraints
            },
            selectedTabIndex = viewStore.state.selectedTabIndex,
            article = currentArticle,
            tabs = tabs,
            selectedArchiveContent = viewStore.state.selectedArchiveContent,
            readerBody = viewStore.state.readerBody,
            selectedArchiveLoadFailed = viewStore.state.selectedArchiveLoadFailed,
        )

        ArticleDetailTabRow(
            modifier = Modifier.constrainAs(tabRow) {
                bottom.linkTo(parent.bottom)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
            selectedTabIndex = viewStore.state.selectedTabIndex,
            tabs = tabs,
            onTabSelected = { viewStore.action { setSelectedTab(it) } }
        )
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
) {
    AnimatedContent(
        targetState = selectedTabIndex,
        modifier = modifier
    ) { targetIndex ->
        when {
            targetIndex == 0 -> ReaderBodyView(
                body = if (!article.text.isNullOrBlank()) ReaderBody.Text else readerBody,
                text = article.text.orEmpty(),
            )
            targetIndex == 1 -> ArticleWebView(article.url ?: article.givenUrl ?: "https://www.google.com/")
            else -> {
                val archiveType = tabs.getOrNull(targetIndex)?.archiveType
                if (archiveType != null) {
                    if (archiveType.providesText) {
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
fun ArticleWebView(
    url: String,
    modifier: Modifier = Modifier,
) {
    val webViewState = rememberWebViewState(url = url)
    val webClient: AccompanistWebViewClient = remember {
        object : AccompanistWebViewClient() {
        }
    }

    val loadingState = webViewState.loadingState
    Column(modifier = modifier) {
        if (loadingState is LoadingState.Loading) {
            LinearProgressIndicator(
                progress = { loadingState.progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp),
            )
        }
        WebView(
            state = webViewState,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(),
            onCreated = {
                it.settings.javaScriptEnabled = true
                it.settings.domStorageEnabled = true
            },
            onDispose = {
            },
            client = webClient
        )
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
 * gutter, a 680 dp centred width and the broken-image placeholder.
 */
@Composable
fun ArticleMarkdown(
    content: String,
    modifier: Modifier = Modifier
) {
    Markdown(
        content = content,
        modifier = modifier.fillMaxSize(),
        colors = markdownColor(),
        typography = readerMarkdownTypography(),
        padding = readerMarkdownPadding(),
        imageTransformer = Coil3ImageTransformerImpl,
        components = readerMarkdownComponents(),
        success = { state, components, columnModifier -> ReaderColumn(state, components, columnModifier) },
    )
}
