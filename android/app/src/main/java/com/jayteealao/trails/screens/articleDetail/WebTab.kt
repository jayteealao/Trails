package com.jayteealao.trails.screens.articleDetail

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.google.accompanist.web.AccompanistWebViewClient
import com.google.accompanist.web.LoadingState
import com.google.accompanist.web.WebView
import com.google.accompanist.web.rememberWebViewState
import com.jayteealao.trails.screens.components.Notice
import com.jayteealao.trails.screens.components.NoticeAction
import com.jayteealao.trails.screens.components.NoticeActionStyle
import com.jayteealao.trails.screens.components.TRY_AGAIN
import com.jayteealao.trails.screens.theme.TrailsTheme

/** Tells [tab] why the page of [attempt] did not load; a failing part of a page is ignored. */
private class WebTabClient(
    private val tab: WebTabState,
    private val attempt: Int,
    private var pageUrl: String,
) : AccompanistWebViewClient() {
    private var pageStarted = false
    private var followedLink = false

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (request.isForMainFrame) {
            pageUrl = request.url.toString()
            // Redirects come here too, also those of the page itself; only a tap has a gesture.
            if (request.hasGesture()) followedLink = true
        }
        return false
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        pageStarted = true
        if (url != null) pageUrl = url
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest?, error: WebResourceError?) {
        // The platform reads the request without a check.
        if (request == null || error == null) return
        super.onReceivedError(view, request, error)
        if (request.isForMainFrame) report(webFailureKindFor(error.errorCode), request.url.toString())
    }

    /** Never goes on with a bad certificate. The callback does not say if it is the page's own. */
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError?) {
        handler.cancel()
        val url = error?.url ?: pageUrl
        if (!pageStarted || isSamePage(url, pageUrl)) report(WebFailureKind.CERTIFICATE, url)
    }

    private fun report(kind: WebFailureKind, url: String) =
        tab.report(attempt, WebFailure(kind, url), followedLink)
}

/**
 * The web page at [url]. When it does not load, a notice that says why takes its place.
 *
 * @param online the phone can reach the internet.
 * @param onOpenInBrowser opens the address that did not load in a browser.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArticleWebView(
    url: String,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    onOpenInBrowser: (String) -> Unit = {},
) {
    val tab = remember(url) { WebTabState(url, online) }
    LaunchedEffect(tab, online) { tab.onOnlineChanged(online) }

    val failure = tab.failure
    if (failure != null) {
        BackHandler(enabled = tab.followedLink) { tab.backToArticle() }
        WebTabNotice(
            failure = failure,
            isArticlePage = !tab.followedLink,
            onRetry = tab::retry,
            onOpenInBrowser = { onOpenInBrowser(failure.url) },
            onBack = tab::backToArticle,
            modifier = modifier.fillMaxSize(),
        )
    } else {
        // Each attempt has its own view and client, so a late report of an old one says nothing.
        key(tab, tab.attempt) {
            val webViewState = rememberWebViewState(url = tab.url)
            val client = remember { WebTabClient(tab, tab.attempt, tab.url) }
            val loadingState = webViewState.loadingState
            Column(modifier = modifier) {
                if (loadingState is LoadingState.Loading) WebTabProgress(loadingState.progress)
                WebView(
                    state = webViewState,
                    modifier = Modifier.fillMaxSize(),
                    onCreated = {
                        it.settings.javaScriptEnabled = true
                        it.settings.domStorageEnabled = true
                    },
                    onDispose = {
                        it.stopLoading()
                        it.destroy()
                    },
                    client = client,
                )
            }
        }
    }
}

/** How much of the page is loaded, from 0 to 1. */
@Composable
fun WebTabProgress(progress: Float, modifier: Modifier = Modifier) {
    LinearProgressIndicator(
        progress = { progress },
        modifier = modifier
            .fillMaxWidth()
            .height(4.dp)
            .semantics { contentDescription = "Loading the page" },
    )
}

/**
 * Why a page did not load, with the ways out. A page with a bad certificate has no Try again.
 *
 * @param isArticlePage it is the page of the article, not one that a link in it leads to.
 */
@Composable
fun WebTabNotice(
    failure: WebFailure,
    isArticlePage: Boolean,
    onRetry: () -> Unit,
    onOpenInBrowser: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val kind = failure.kind
    val offline = kind == WebFailureKind.OFFLINE
    val words = webFailureWords(failure)
    Notice(
        icon = if (offline) ReaderNoticeIcons.Offline else ReaderNoticeIcons.Failed,
        title = words.title,
        text = words.text,
        modifier = modifier,
        isError = !offline,
        actions = buildList {
            if (kind.canRetry) add(NoticeAction(TRY_AGAIN, NoticeActionStyle.FILLED, onRetry))
            if (kind.offersBrowser && isWebAddress(failure.url)) {
                add(NoticeAction("Open in browser", NoticeActionStyle.TEXT, onOpenInBrowser))
            }
            if (!kind.canRetry && !kind.offersBrowser && !isArticlePage) {
                add(NoticeAction("Back to the page", NoticeActionStyle.TEXT, onBack))
            }
        },
    )
}

private const val WORST_URL = "https://reading-room.archive.the-longest-subdomain-in-the-list.example.org/a"

@Composable
private fun WebTabPreview(failure: WebFailure, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
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
}

@Preview(name = "Web tab • no answer • light", showBackground = true, widthDp = 411, heightDp = 700)
@Composable
private fun WebTabNoAnswerLightPreview() {
    WebTabPreview(WebFailure(WebFailureKind.NO_ANSWER, "https://example.org/a"))
}

@Preview(
    name = "Web tab • no answer • dark",
    showBackground = true,
    widthDp = 411,
    heightDp = 700,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun WebTabNoAnswerDarkPreview() {
    WebTabPreview(WebFailure(WebFailureKind.NO_ANSWER, "https://example.org/a"), darkTheme = true)
}

@Preview(name = "Web tab • offline • light", showBackground = true, widthDp = 411, heightDp = 700)
@Composable
private fun WebTabOfflinePreview() {
    WebTabPreview(WebFailure(WebFailureKind.OFFLINE, "https://example.org/a"))
}

@Preview(name = "Web tab • worst • light", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun WebTabWorstPreview() {
    WebTabPreview(WebFailure(WebFailureKind.CERTIFICATE, WORST_URL))
}

@Preview(name = "Web tab • large font", showBackground = true, widthDp = 360, heightDp = 640, fontScale = 2f)
@Composable
private fun WebTabLargeFontPreview() {
    WebTabPreview(WebFailure(WebFailureKind.CERTIFICATE, WORST_URL))
}

@Preview(name = "Web tab • loading • light", showBackground = true, widthDp = 411, heightDp = 700)
@Composable
private fun WebTabLoadingPreview() {
    TrailsTheme(darkTheme = false) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Box(Modifier.fillMaxSize()) { WebTabProgress(0.45f) }
        }
    }
}
