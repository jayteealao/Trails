package com.jayteealao.trails.common

import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.computeNormalizedUrl
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlNormalizerTest {

    // The cases live in warg/packages/url-normalizer/fixtures and are shared with the
    // TypeScript normalizer the Warg functions use; build.gradle.kts adds that folder
    // to the unit-test resources.
    @Test
    fun `normalizeUrl matches every shared fixture`() {
        val stream = javaClass.classLoader?.getResourceAsStream(FIXTURE)
        assertNotNull(
            "$FIXTURE is missing from the unit-test resources; check the test sourceSets block in app/build.gradle.kts",
            stream,
        )
        val text = stream!!.use { it.readBytes().toString(Charsets.UTF_8) }
        val cases = Json.parseToJsonElement(text).jsonObject.getValue("cases").jsonArray

        val mismatches = mutableListOf<String>()
        for (case in cases) {
            val row = case.jsonObject
            val name = row.getValue("name").jsonPrimitive.content
            val input = row.getValue("input").jsonPrimitive.content
            val expected = row.getValue("expected").jsonPrimitive.content
            val actual = normalizeUrl(input)
            if (actual != expected) {
                mismatches += "$name: ${JsonPrimitive(input)} -> ${JsonPrimitive(actual)} " +
                    "(expected ${JsonPrimitive(expected)})"
            }
        }

        assertTrue(
            "${mismatches.size} of ${cases.size} fixture rows differ:\n" + mismatches.joinToString("\n"),
            mismatches.isEmpty(),
        )
        assertTrue("expected at least 50 fixture rows, found ${cases.size}", cases.size >= 50)
    }

    // Article.computeNormalizedUrl() extension tests — assert byte-for-byte parity with
    // the inline expression normalizeUrl(article.url ?: article.givenUrl ?: "")

    @Test
    fun `computeNormalizedUrl uses url when non-null`() {
        val article = Article(itemId = "a1", url = "https://example.com/post?utm_source=x", givenUrl = "https://other.com/")
        assertEquals(normalizeUrl(article.url ?: article.givenUrl ?: ""), article.computeNormalizedUrl())
        assertEquals("https://example.com/post", article.computeNormalizedUrl())
    }

    @Test
    fun `computeNormalizedUrl falls back to givenUrl when url is null`() {
        val article = Article(itemId = "a2", url = null, givenUrl = "https://example.com/fallback")
        assertEquals(normalizeUrl(article.url ?: article.givenUrl ?: ""), article.computeNormalizedUrl())
        assertEquals("https://example.com/fallback", article.computeNormalizedUrl())
    }

    @Test
    fun `computeNormalizedUrl prefers url over givenUrl when both non-null`() {
        val article = Article(itemId = "a3", url = "https://primary.com/a", givenUrl = "https://secondary.com/b")
        assertEquals(normalizeUrl(article.url ?: article.givenUrl ?: ""), article.computeNormalizedUrl())
        assertEquals("https://primary.com/a", article.computeNormalizedUrl())
    }

    @Test
    fun `computeNormalizedUrl returns empty string when both url and givenUrl are null`() {
        val article = Article(itemId = "a4", url = null, givenUrl = null)
        assertEquals(normalizeUrl(article.url ?: article.givenUrl ?: ""), article.computeNormalizedUrl())
        assertEquals("", article.computeNormalizedUrl())
    }

    private companion object {
        const val FIXTURE = "url-normalizer-cases.json"
    }
}
