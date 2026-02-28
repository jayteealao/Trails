@file:OptIn(ExperimentalMaterial3Api::class)

package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import android.app.Activity
import android.content.res.Configuration
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.constraintlayout.compose.ConstraintLayout
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebContent
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.preview.PreviewFixtures
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownPadding
import compose.icons.CssGgIcons
import compose.icons.cssggicons.AlignMiddle
import compose.icons.cssggicons.Browser
import io.yumemi.tartlet.ViewStore
import io.yumemi.tartlet.rememberViewStore

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleDetailScreen(
    article: Article,
    viewStore: ViewStore<ArticleDetailState, ArticleDetailEvent, ArticleDetailViewModel> = rememberViewStore { hiltViewModel() }
) {
    // Launcher for Google storage consent — one-time approval
    val consentLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            viewStore.action { retryArchiveSync() }
        }
    }

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

    viewStore.handle<ArticleDetailEvent.StorageConsentNeeded> { event ->
        consentLauncher.launch(event.intent)
    }

    val currentArticle = viewStore.state.article ?: article
    val archiveTabs = viewStore.state.localArchives.mapNotNull {
        ArchiveType.fromArchiveKey(it.archiveKey)
    }

    ConstraintLayout(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 56.dp)
    ) {
        val (tabRow, detailView) = createRefs()

        ArticleDetails(
            modifier = Modifier.constrainAs(detailView) {
                top.linkTo(parent.top)
                bottom.linkTo(tabRow.top)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
            selectedTabIndex = viewStore.state.selectedTabIndex,
            article = currentArticle,
            archiveTabs = archiveTabs,
            selectedArchiveContent = viewStore.state.selectedArchiveContent,
        )

        ArticleDetailTabRow(
            modifier = Modifier.constrainAs(tabRow) {
                bottom.linkTo(parent.bottom)
                start.linkTo(parent.start)
                end.linkTo(parent.end)
            },
            selectedTabIndex = viewStore.state.selectedTabIndex,
            archiveTabs = archiveTabs,
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
            archiveTabs = listOf(ArchiveType.SINGLEFILE, ArchiveType.READABILITY),
            selectedArchiveContent = "<h1>Archived Content</h1><p>This is archived HTML.</p>",
        )
    }
}

@Composable
fun ArticleDetailTabRow(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = 1,
    archiveTabs: List<ArchiveType> = emptyList(),
    onTabSelected: (Int) -> Unit = {}
) {
    ScrollableTabRow(
        selectedTabIndex = selectedTabIndex,
        modifier = modifier.windowInsetsPadding(WindowInsets.navigationBars),
        containerColor = MaterialTheme.colorScheme.surface,
        edgePadding = 16.dp,
    ) {
        Tab(
            selected = selectedTabIndex == 0,
            onClick = { onTabSelected(0) },
            icon = {
                Icon(CssGgIcons.AlignMiddle, contentDescription = "Reader")
            }
        )

        Tab(
            selected = selectedTabIndex == 1,
            onClick = { onTabSelected(1) },
            icon = {
                Icon(CssGgIcons.Browser, contentDescription = "Web")
            }
        )

        archiveTabs.forEachIndexed { index, archiveType ->
            val tabIndex = index + 2
            Tab(
                selected = selectedTabIndex == tabIndex,
                onClick = { onTabSelected(tabIndex) },
                text = { Text(archiveType.displayName) }
            )
        }
    }
}

@Composable
fun ArticleDetails(
    modifier: Modifier = Modifier,
    selectedTabIndex: Int = 1,
    article: Article,
    archiveTabs: List<ArchiveType> = emptyList(),
    selectedArchiveContent: String? = null,
) {
    AnimatedContent(
        targetState = selectedTabIndex,
        modifier = modifier
    ) { targetIndex ->
        when {
            targetIndex == 0 -> ArticleMarkdown(article.text ?: "No content")
            targetIndex == 1 -> ArticleWebView(article.url ?: article.givenUrl ?: "https://www.google.com/")
            else -> {
                val archiveIndex = targetIndex - 2
                if (archiveIndex in archiveTabs.indices) {
                    val archiveType = archiveTabs[archiveIndex]
                    if (archiveType.providesText) {
                        ArticleMarkdown(selectedArchiveContent ?: "Loading...")
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

@Composable
fun ArticleMarkdown(
    content: String,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()
    Markdown(
        content = content,
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(scrollState),
        colors = markdownColor(),
        typography = markdownTypography(),
        imageTransformer = Coil3ImageTransformerImpl,
        padding = markdownPadding(block = 4.dp)
    )
}
