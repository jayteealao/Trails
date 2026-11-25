package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Why a page did not load, what the Web tab says about it, and what it loads next. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class WebTabStateTest {

    private fun noAnswer(url: String = ARTICLE) = WebFailure(WebFailureKind.NO_ANSWER, url)

    private fun words(kind: WebFailureKind, url: String = "https://example.org/a") =
        webFailureWords(WebFailure(kind, url))

    // --- The kind ---

    @Test
    fun `each error code has its kind`() {
        for (code in listOf(-2, -6, -7, -8)) assertEquals("$code", WebFailureKind.NO_ANSWER, webFailureKindFor(code))
        assertEquals(WebFailureKind.CERTIFICATE, webFailureKindFor(-11))
        assertEquals(WebFailureKind.UNSAFE, webFailureKindFor(-16))
        assertEquals(WebFailureKind.NOT_A_PAGE, webFailureKindFor(-10))
        for (code in listOf(-1, -3, -4, -5, -9, -12, -13, -14, -15, -99)) {
            assertEquals("$code", WebFailureKind.NOT_OPENED, webFailureKindFor(code))
        }
    }

    @Test
    fun `a page that is not safe or not a page is never tried again`() {
        assertFalse(WebFailureKind.CERTIFICATE.canRetry)
        assertFalse(WebFailureKind.UNSAFE.canRetry)
        assertFalse(WebFailureKind.NOT_A_PAGE.canRetry)
    }

    // --- The words ---

    @Test
    fun `the words name the site`() {
        assertEquals(
            WebFailureWords(
                "This page did not load", "example.org did not answer. The Reader tab may still have the text.",
            ),
            words(WebFailureKind.NO_ANSWER),
        )
        assertEquals(
            WebFailureWords(
                "This page did not load", "example.org could not be opened. The Reader tab may still have the text.",
            ),
            words(WebFailureKind.NOT_OPENED),
        )
        assertEquals(
            WebFailureWords(
                "This page is not safe to open",
                "The security certificate of example.org is not valid, so Trails did not load it.",
            ),
            words(WebFailureKind.CERTIFICATE),
        )
        assertEquals(
            WebFailureWords(
                "This page is not safe to open", "example.org was reported as unsafe, so Trails did not load it.",
            ),
            words(WebFailureKind.UNSAFE),
        )
    }

    @Test
    fun `offline and a link that is no page name no site`() {
        assertEquals(
            WebFailureWords("You’re offline", "The web page needs a connection. The Reader tab works offline."),
            words(WebFailureKind.OFFLINE),
        )
        assertEquals(
            WebFailureWords("This page did not load", "Trails cannot open this kind of link."),
            words(WebFailureKind.NOT_A_PAGE),
        )
    }

    @Test
    fun `an address with no host is the site`() {
        for (url in listOf("", "not a url", "mailto:jo@example.com")) {
            assertTrue(url, words(WebFailureKind.NO_ANSWER, url).text.startsWith("The site did not answer."))
            assertTrue(url, "certificate of the site is" in words(WebFailureKind.CERTIFICATE, url).text)
        }
    }

    @Test
    fun `a long host stays whole, and a port is left out`() {
        val host = "reading-room.archive.the-longest-subdomain-in-the-list.example.org"
        assertTrue(host in words(WebFailureKind.CERTIFICATE, "https://$host/a").text)
        assertEquals("example.org", siteOf("https://example.org:8443/a"))
    }

    @Test
    fun `only http and https go to a browser`() {
        assertTrue(isWebAddress("http://example.org"))
        assertTrue(isWebAddress("HTTPS://example.org"))
        for (url in listOf("mailto:jo@example.com", "intent://x#Intent;end", "file:///a", "javascript:1", "", "x")) {
            assertFalse(url, isWebAddress(url))
        }
    }

    @Test
    fun `pages are compared in canonical form`() {
        assertTrue(isSamePage("https://example.org", "https://EXAMPLE.org:443/"))
        assertFalse(isSamePage("https://example.org/a", "https://example.org/a/"))
        assertFalse(isSamePage("https://example.org/a", "https://example.org/b"))
        assertTrue(isSamePage("mailto:a", "mailto:a"))
        assertFalse(isSamePage("mailto:a", "https://example.org"))
    }

    // --- The state ---

    @Test
    fun `only the first report of an attempt counts`() {
        val state = WebTabState(ARTICLE, online = true)
        state.report(0, noAnswer())
        state.report(0, WebFailure(WebFailureKind.CERTIFICATE, ARTICLE), followedLink = true)

        assertEquals(noAnswer(), state.failure)
        assertFalse(state.followedLink)
    }

    @Test
    fun `a report of an old attempt is dropped`() {
        val state = WebTabState(ARTICLE, online = true)
        state.report(0, noAnswer())
        state.retry()
        state.report(0, noAnswer())

        assertNull(state.failure)
        assertEquals(1, state.attempt)
    }

    @Test
    fun `a failure while offline is offline, and loads once when back online`() {
        val state = WebTabState(ARTICLE, online = false)
        state.report(0, noAnswer())
        assertEquals(WebFailureKind.OFFLINE, state.failure?.kind)

        state.onOnlineChanged(false)
        assertEquals(0, state.attempt)
        state.onOnlineChanged(true)
        assertNull(state.failure)
        assertEquals(1, state.attempt)

        state.report(1, noAnswer())
        state.onOnlineChanged(true)
        assertEquals(WebFailureKind.NO_ANSWER, state.failure?.kind)
        assertEquals(1, state.attempt)
    }

    @Test
    fun `going offline after a failure explains it`() {
        for (kind in listOf(WebFailureKind.NO_ANSWER, WebFailureKind.NOT_OPENED)) {
            val state = WebTabState(ARTICLE, online = true)
            state.report(0, WebFailure(kind, ARTICLE))
            state.onOnlineChanged(false)
            assertEquals(WebFailureKind.OFFLINE, state.failure?.kind)
        }
    }

    @Test
    fun `offline does not explain a bad certificate, an unsafe page or another kind of link`() {
        for (kind in listOf(WebFailureKind.CERTIFICATE, WebFailureKind.UNSAFE, WebFailureKind.NOT_A_PAGE)) {
            val state = WebTabState(ARTICLE, online = false)
            state.report(0, WebFailure(kind, ARTICLE))
            assertEquals(kind, state.failure?.kind)
            state.onOnlineChanged(true)
            assertEquals(kind, state.failure?.kind)
        }
    }

    @Test
    fun `try again loads the page that failed, back loads the article`() {
        val state = WebTabState(ARTICLE, online = true)
        state.report(0, noAnswer("https://other.example/b"), followedLink = true)
        state.retry()
        assertEquals("https://other.example/b", state.url)
        assertTrue(state.followedLink)

        state.report(1, noAnswer("https://other.example/b"))
        assertTrue(state.followedLink)
        state.backToArticle()
        assertEquals(ARTICLE, state.url)
        assertEquals(2, state.attempt)
        assertNull(state.failure)
        assertFalse(state.followedLink)
    }

    private companion object {
        const val ARTICLE = "https://example.org/a"
    }
}
