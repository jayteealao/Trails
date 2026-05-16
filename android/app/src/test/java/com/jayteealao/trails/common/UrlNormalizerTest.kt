package com.jayteealao.trails.common

import org.junit.Assert.assertEquals
import org.junit.Test

class UrlNormalizerTest {

    @Test
    fun `normalizeUrl lowercases scheme and host but preserves path case`() {
        assertEquals(
            "https://example.com/Article",
            normalizeUrl("HTTPS://EXAMPLE.COM/Article")
        )
    }

    @Test
    fun `normalizeUrl strips utm tracking params`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article?utm_source=twitter&utm_medium=social&utm_campaign=launch")
        )
    }

    @Test
    fun `normalizeUrl strips fbclid and gclid`() {
        assertEquals(
            "https://example.com/post",
            normalizeUrl("https://example.com/post?fbclid=abc123&gclid=xyz789")
        )
    }

    @Test
    fun `normalizeUrl strips msclkid and dclid`() {
        assertEquals(
            "https://example.com/page",
            normalizeUrl("https://example.com/page?msclkid=abc&dclid=def")
        )
    }

    @Test
    fun `normalizeUrl preserves non-tracking query params`() {
        assertEquals(
            "https://example.com/search?page=2&q=kotlin",
            normalizeUrl("https://example.com/search?q=kotlin&page=2")
        )
    }

    @Test
    fun `normalizeUrl strips fragment`() {
        assertEquals(
            "https://example.com/page",
            normalizeUrl("https://example.com/page#section-1")
        )
    }

    @Test
    fun `normalizeUrl removes trailing slash for non-root paths`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article/")
        )
    }

    @Test
    fun `normalizeUrl preserves trailing slash for root path`() {
        assertEquals(
            "https://example.com/",
            normalizeUrl("https://example.com/")
        )
    }

    @Test
    fun `normalizeUrl preserves ref param`() {
        assertEquals(
            "https://github.com/user/repo?ref=main",
            normalizeUrl("https://github.com/user/repo?ref=main")
        )
    }

    @Test
    fun `normalizeUrl strips ref_src tracking param`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article?ref_src=twsrc")
        )
    }

    @Test
    fun `normalizeUrl strips ref_url tracking param`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article?ref_url=https%3A%2F%2Ft.co%2Ffoo")
        )
    }

    @Test
    fun `normalizeUrl sorts query params by name`() {
        assertEquals(
            "https://example.com/search?a=1&b=2",
            normalizeUrl("https://example.com/search?b=2&a=1")
        )
    }

    @Test
    fun `normalizeUrl returns unparseable string unchanged`() {
        assertEquals("not-a-url", normalizeUrl("not-a-url"))
        assertEquals("", normalizeUrl(""))
        assertEquals("ftp://files.example.com/data", normalizeUrl("ftp://files.example.com/data"))
    }

    @Test
    fun `normalizeUrl handles mixed tracking and non-tracking params`() {
        assertEquals(
            "https://example.com/page?id=42",
            normalizeUrl("https://example.com/page?utm_campaign=launch&id=42&gclid=xyz")
        )
    }

    @Test
    fun `normalizeUrl handles url with no query params`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article")
        )
    }

    @Test
    fun `normalizeUrl handles url with only tracking params`() {
        assertEquals(
            "https://example.com/article",
            normalizeUrl("https://example.com/article?utm_source=google&fbclid=abc")
        )
    }

    @Test
    fun `normalizeUrl handles complex url with multiple features`() {
        assertEquals(
            "https://example.com/path/to/article?id=123&page=2",
            normalizeUrl("HTTPS://EXAMPLE.COM/path/to/article/?id=123&utm_source=email&page=2#comments")
        )
    }
}
