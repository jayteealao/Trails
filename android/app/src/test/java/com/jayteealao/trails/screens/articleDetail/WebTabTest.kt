package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import android.net.Uri
import android.net.http.SslError
import android.view.View
import android.view.ViewGroup
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** What the Web tab shows for each callback of its WebView. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class WebTabTest {

    @get:Rule
    val rule = createComposeRule()

    private var online by mutableStateOf(true)
    private val opened = mutableListOf<String>()
    private lateinit var root: View
    private lateinit var back: OnBackPressedDispatcher

    private val tryAgain = hasText("Try again") and hasClickAction()
    private val openInBrowser = hasText("Open in browser") and hasClickAction()
    private val backToThePage = hasText("Back to the page") and hasClickAction()

    private fun show() {
        rule.setContent {
            root = LocalView.current.rootView
            back = LocalOnBackPressedDispatcherOwner.current!!.onBackPressedDispatcher
            TrailsTheme(darkTheme = false) {
                ArticleWebView(url = ARTICLE, online = online, onOpenInBrowser = { opened += it })
            }
        }
        rule.waitForIdle()
    }

    private fun webViewOrNull(view: View = root): WebView? = when (view) {
        is WebView -> view
        is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { webViewOrNull(view.getChildAt(it)) }
        else -> null
    }

    private val webView: WebView get() = rule.runOnIdle { webViewOrNull()!! }

    /** Runs [block] on [view], with its client, as a callback of the platform would. */
    private fun callback(view: WebView = webView, block: WebViewClient.(WebView) -> Unit) {
        rule.runOnIdle { shadowOf(view).webViewClient.block(view) }
        rule.waitForIdle()
    }

    private fun request(url: String, mainFrame: Boolean = true, gesture: Boolean = false) =
        mockk<WebResourceRequest> {
            every { this@mockk.url } returns Uri.parse(url)
            every { isForMainFrame } returns mainFrame
            every { hasGesture() } returns gesture
            every { isRedirect } returns false
        }

    private fun error(code: Int) = mockk<WebResourceError> {
        every { errorCode } returns code
        every { description } returns "net::ERR_RAW"
    }

    private fun failLoad(url: String = ARTICLE, code: Int = WebViewClient.ERROR_HOST_LOOKUP, mainFrame: Boolean = true) =
        callback { onReceivedError(it, request(url, mainFrame), error(code)) }

    private fun start(url: String = ARTICLE) = callback { onPageStarted(it, url, null) }

    private fun follow(url: String, gesture: Boolean) =
        callback { shouldOverrideUrlLoading(it, request(url, gesture = gesture)) }

    /** Reports a bad certificate of [url] and checks that the load is cancelled, once. */
    private fun failCertificate(url: String) {
        val handler = mockk<SslErrorHandler>(relaxed = true)
        val sslError = mockk<SslError> { every { this@mockk.url } returns url }
        callback { onReceivedSslError(it, handler, sslError) }
        verify(exactly = 1) { handler.cancel() }
        verify(exactly = 0) { handler.proceed() }
    }

    private fun assertNoNotice(view: WebView) {
        rule.onNodeWithText(NOT_LOADED).assertDoesNotExist()
        rule.onNodeWithText(NOT_SAFE).assertDoesNotExist()
        assertSame(view, webView)
    }

    private fun assertWebViewGone() = assertNull(rule.runOnIdle { webViewOrNull() })

    // --- No answer ---

    @Test
    fun noAnswer_namesTheSite_andTakesThePlaceOfThePage() {
        show()
        failLoad()

        rule.onNodeWithText(NOT_LOADED).assertIsDisplayed()
        rule.onNodeWithText("example.org did not answer. The Reader tab may still have the text.").assertIsDisplayed()
        rule.onNodeWithText("ERR_RAW", substring = true).assertDoesNotExist()
        assertWebViewGone()
    }

    @Test
    fun tryAgain_loadsThePageInANewWebView() {
        show()
        val first = webView
        failLoad()
        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()

        assertNotSame(first, webView)
        assertEquals(ARTICLE, shadowOf(webView).lastLoadedUrl)
        assertTrue(shadowOf(first).wasDestroyCalled())
        rule.onNodeWithText(NOT_LOADED).assertDoesNotExist()
    }

    @Test
    fun openInBrowser_givesTheAddressThatFailed() {
        show()
        failLoad("https://www.example.org/moved")
        rule.onNode(openInBrowser).performClick()

        assertEquals(listOf("https://www.example.org/moved"), opened)
    }

    @Test
    fun lateCallbacksOfTheOldView_doNotBringThePageBack_norFailTheNextLoad() {
        show()
        val first = webView
        val oldClient = rule.runOnIdle { shadowOf(first).webViewClient }
        failLoad()
        rule.runOnIdle {
            oldClient.onPageStarted(first, ARTICLE, null)
            oldClient.onPageFinished(first, ARTICLE)
        }
        rule.onNodeWithText(NOT_LOADED).assertIsDisplayed()
        assertWebViewGone()

        rule.onNode(tryAgain).performClick()
        rule.waitForIdle()
        rule.runOnIdle { oldClient.onReceivedError(first, request(ARTICLE), error(WebViewClient.ERROR_CONNECT)) }
        assertNoNotice(webView)
    }

    // --- Offline ---

    @Test
    fun offline_offersTryAgainOnly_andLoadsWhenBackOnline() {
        online = false
        show()
        failLoad()

        rule.onNodeWithText("You’re offline").assertIsDisplayed()
        rule.onNode(tryAgain).assertIsDisplayed()
        rule.onNode(openInBrowser).assertDoesNotExist()

        online = true
        rule.waitForIdle()
        rule.onNodeWithText("You’re offline").assertDoesNotExist()
        assertEquals(ARTICLE, shadowOf(webView).lastLoadedUrl)
    }

    @Test
    fun offlineWithAPageThatLoads_showsThePage() {
        online = false
        show()
        val view = webView
        start()
        callback { onPageFinished(it, ARTICLE) }

        rule.onNodeWithText("You’re offline").assertDoesNotExist()
        assertNoNotice(view)
    }

    // --- Parts of a page ---

    @Test
    fun aFailingPartOfThePage_showsNoNotice() {
        show()
        val view = webView
        failLoad("https://cdn.example.org/early.js", mainFrame = false)
        start()
        failLoad("https://cdn.example.org/a.js", mainFrame = false)
        failLoad("https://ads.example.net/frame", WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, mainFrame = false)
        callback { onReceivedError(it, null, error(WebViewClient.ERROR_CONNECT)) }
        callback { onReceivedError(it, request(ARTICLE), null) }
        callback { onPageFinished(it, ARTICLE) }

        assertNoNotice(view)
    }

    @Test
    fun aBadCertificateOfAPart_isCancelled_andShowsNoNotice() {
        show()
        val view = webView
        start()
        failCertificate("https://cdn.example.org/a.js")

        assertNoNotice(view)
    }

    // --- Certificates ---

    private fun assertNotSafe(host: String) {
        rule.onNodeWithText(NOT_SAFE).assertIsDisplayed()
        rule.onNodeWithText("The security certificate of $host is not valid, so Trails did not load it.")
            .assertIsDisplayed()
        rule.onNode(tryAgain).assertDoesNotExist()
        assertWebViewGone()
    }

    @Test
    fun aBadCertificateOfThePage_isCancelled_withNoTryAgain() {
        show()
        failCertificate("$ARTICLE?x")

        assertNotSafe("example.org")
        rule.onNode(openInBrowser).assertIsDisplayed()
    }

    @Test
    fun aBadCertificateAfterTheStart_isOfThePage() {
        show()
        start()
        failCertificate(ARTICLE)

        assertNotSafe("example.org")
    }

    @Test
    fun aBadCertificateAfterARedirect_isOfThePage() {
        show()
        start()
        follow("https://www.example.net/b", gesture = false)
        failCertificate("https://www.example.net/b")

        assertNotSafe("www.example.net")
    }

    @Test
    fun aBadCertificateOfAFollowedLink_isOfThePage() {
        show()
        start()
        callback { onPageFinished(it, ARTICLE) }
        follow("https://other.example", gesture = true)
        // The platform reports the address in canonical form.
        failCertificate("https://other.example/")

        assertNotSafe("other.example")
    }

    @Test
    fun aFailedHandshake_hasNoTryAgain() {
        show()
        failLoad(code = WebViewClient.ERROR_FAILED_SSL_HANDSHAKE)

        assertNotSafe("example.org")
    }

    // --- Links ---

    @Test
    fun aFailedLink_backReturnsToTheArticle() {
        show()
        start()
        follow("https://other.example/b", gesture = true)
        failLoad("https://other.example/b")
        rule.onNodeWithText("other.example did not answer. The Reader tab may still have the text.").assertIsDisplayed()

        assertTrue(rule.runOnIdle { back.hasEnabledCallbacks() })
        rule.runOnIdle { back.onBackPressed() }
        rule.waitForIdle()
        assertEquals(ARTICLE, shadowOf(webView).lastLoadedUrl)
    }

    @Test
    fun aFailedRedirectOfTheArticle_leavesBackAlone() {
        show()
        follow("https://www.example.org/b", gesture = false)
        failLoad("https://www.example.org/b")

        rule.onNodeWithText(NOT_LOADED).assertIsDisplayed()
        assertEquals(false, rule.runOnIdle { back.hasEnabledCallbacks() })
    }

    @Test
    fun aLinkThatIsNoPage_offersTheWayBack() {
        show()
        start()
        follow("mailto:jo@example.com", gesture = true)
        failLoad("mailto:jo@example.com", WebViewClient.ERROR_UNSUPPORTED_SCHEME)

        rule.onNodeWithText("Trails cannot open this kind of link.").assertIsDisplayed()
        rule.onNode(tryAgain).assertDoesNotExist()
        rule.onNode(openInBrowser).assertDoesNotExist()
        rule.onNode(backToThePage).performClick()
        rule.waitForIdle()
        assertEquals(ARTICLE, shadowOf(webView).lastLoadedUrl)
    }

    @Test
    fun anUnsafeArticlePage_hasNoActions() {
        show()
        failLoad(code = WebViewClient.ERROR_UNSAFE_RESOURCE)

        rule.onNodeWithText("example.org was reported as unsafe, so Trails did not load it.").assertIsDisplayed()
        rule.onNode(hasClickAction()).assertDoesNotExist()
    }

    // --- Progress ---

    @Test
    fun theProgressBarHasItsName_whileThePageLoads() {
        show()
        start()
        rule.onNode(hasContentDescription("Loading the page")).assertExists()
        callback { onPageFinished(it, ARTICLE) }
        rule.onNode(hasContentDescription("Loading the page")).assertDoesNotExist()
    }

    private companion object {
        const val ARTICLE = "https://example.org/a"
        const val NOT_LOADED = "This page did not load"
        const val NOT_SAFE = "This page is not safe to open"
    }
}
