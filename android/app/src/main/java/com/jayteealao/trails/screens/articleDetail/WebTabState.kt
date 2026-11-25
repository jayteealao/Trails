package com.jayteealao.trails.screens.articleDetail

import android.net.Uri
import android.webkit.WebViewClient
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Why a page did not load on the Web tab.
 *
 * @property canRetry the same request can give another answer later.
 * @property offersBrowser a browser may open what this tab does not.
 */
enum class WebFailureKind(val canRetry: Boolean, val offersBrowser: Boolean) {
    /** The site was not found, did not answer or broke the connection. */
    NO_ANSWER(canRetry = true, offersBrowser = true),

    /** [NO_ANSWER] or [NOT_OPENED] while the phone is offline. */
    OFFLINE(canRetry = true, offersBrowser = false),

    /** Any other failed load. */
    NOT_OPENED(canRetry = true, offersBrowser = true),

    /** The certificate is not valid. There is no way to load the page here. */
    CERTIFICATE(canRetry = false, offersBrowser = true),

    /** The page is on a list of unsafe pages. */
    UNSAFE(canRetry = false, offersBrowser = false),

    /** The link is not one to a page, for example a mail address. */
    NOT_A_PAGE(canRetry = false, offersBrowser = false),
}

/** The page at [url] did not load. */
data class WebFailure(val kind: WebFailureKind, val url: String)

/** The title and the line of a [WebFailure]. */
data class WebFailureWords(val title: String, val text: String)

/** The kind of the main-page error [errorCode], one of the `WebViewClient.ERROR_` codes. */
fun webFailureKindFor(errorCode: Int): WebFailureKind = when (errorCode) {
    WebViewClient.ERROR_HOST_LOOKUP,
    WebViewClient.ERROR_CONNECT,
    WebViewClient.ERROR_IO,
    WebViewClient.ERROR_TIMEOUT -> WebFailureKind.NO_ANSWER
    // Certificate errors that cannot be overridden come with the handshake code.
    WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> WebFailureKind.CERTIFICATE
    WebViewClient.ERROR_UNSAFE_RESOURCE -> WebFailureKind.UNSAFE
    WebViewClient.ERROR_UNSUPPORTED_SCHEME -> WebFailureKind.NOT_A_PAGE
    else -> WebFailureKind.NOT_OPENED
}

/** What the Web tab says about [failure]. A site with no known host is called the site. */
fun webFailureWords(failure: WebFailure): WebFailureWords {
    val site = siteOf(failure.url)
    val atStart = site ?: "The site"
    return when (failure.kind) {
        WebFailureKind.NO_ANSWER ->
            WebFailureWords(NOT_LOADED, "$atStart did not answer. The Reader tab may still have the text.")
        WebFailureKind.OFFLINE ->
            WebFailureWords("You’re offline", "The web page needs a connection. The Reader tab works offline.")
        WebFailureKind.NOT_OPENED ->
            WebFailureWords(NOT_LOADED, "$atStart could not be opened. The Reader tab may still have the text.")
        WebFailureKind.CERTIFICATE -> WebFailureWords(
            NOT_SAFE,
            "The security certificate of ${site ?: "the site"} is not valid, so Trails did not load it.",
        )
        WebFailureKind.UNSAFE ->
            WebFailureWords(NOT_SAFE, "$atStart was reported as unsafe, so Trails did not load it.")
        WebFailureKind.NOT_A_PAGE ->
            WebFailureWords(NOT_LOADED, "Trails cannot open this kind of link.")
    }
}

private const val NOT_LOADED = "This page did not load"
private const val NOT_SAFE = "This page is not safe to open"

/** The host of [url], or null when it has none. */
fun siteOf(url: String): String? = Uri.parse(url).host?.takeIf { it.isNotBlank() }

/** Whether a browser can be asked to open [url]. */
fun isWebAddress(url: String): Boolean = Uri.parse(url).scheme?.lowercase() in setOf("http", "https")

/** Whether [a] and [b] are the same address once both are in canonical form. */
fun isSamePage(a: String, b: String): Boolean {
    val first = a.toHttpUrlOrNull()
    val second = b.toHttpUrlOrNull()
    return if (first != null && second != null) first == second else a == b
}

/**
 * What the Web tab of the article at [articleUrl] loads, and why the last load failed. Each load
 * has its own [attempt], and each attempt has at most one [failure]: the first that is reported.
 */
@Stable
class WebTabState(private val articleUrl: String, private var online: Boolean) {
    /** The address that [attempt] loads. */
    var url by mutableStateOf(articleUrl)
        private set
    var attempt by mutableIntStateOf(0)
        private set
    var failure by mutableStateOf<WebFailure?>(null)
        private set

    /** The person followed a link away from the article, so Back has an article to return to. */
    var followedLink by mutableStateOf(false)
        private set

    /** Takes a failure of [attempt]. One of an older attempt, or a second one, changes nothing. */
    fun report(attempt: Int, failure: WebFailure, followedLink: Boolean = false) {
        if (attempt != this.attempt || this.failure != null) return
        this.failure = failure.copy(kind = kindNow(failure.kind))
        if (followedLink) this.followedLink = true
    }

    /**
     * Going offline explains a failed load; the page of an offline notice loads again when the
     * phone is back online.
     */
    fun onOnlineChanged(online: Boolean) {
        this.online = online
        val failed = failure ?: return
        if (online) {
            if (failed.kind == WebFailureKind.OFFLINE) retry()
        } else {
            failure = failed.copy(kind = kindNow(failed.kind))
        }
    }

    /** Loads the page that failed again. */
    fun retry() {
        val failed = failure ?: return
        load(failed.url)
    }

    /** Leaves a link that did not load for the article. */
    fun backToArticle() {
        followedLink = false
        load(articleUrl)
    }

    private fun load(url: String) {
        this.url = url
        failure = null
        attempt++
    }

    private fun kindNow(kind: WebFailureKind): WebFailureKind = when (kind) {
        WebFailureKind.NO_ANSWER, WebFailureKind.NOT_OPENED -> if (online) kind else WebFailureKind.OFFLINE
        else -> kind
    }
}
