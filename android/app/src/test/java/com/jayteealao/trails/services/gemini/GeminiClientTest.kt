package com.jayteealao.trails.services.gemini

import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.type.GenerateContentResponse
import com.google.firebase.ai.type.TextPart
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GeminiClientTest {

    private lateinit var geminiClient: GeminiClient

    @Before
    fun setUp() {
        geminiClient = GeminiClient()
    }

    @Test
    fun `filterAndNormalizeTags returns exact matches from allowed list`() = runTest {
        // Given
        val suggestedTags = listOf("Android", "kotlin", "COMPOSE", "Design")
        val allowedTags = listOf("android", "kotlin", "compose", "design", "architecture")

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod(
                "filterAndNormalizeTags",
                List::class.java,
                List::class.java
            )
            .apply { isAccessible = true }
            .invoke(geminiClient, suggestedTags, allowedTags) as List<*>

        // Then
        assertEquals(4, result.size)
        assertTrue(result.contains("android"))
        assertTrue(result.contains("kotlin"))
        assertTrue(result.contains("compose"))
        assertTrue(result.contains("design"))
    }

    @Test
    fun `filterAndNormalizeTags ignores tags not in allowed list`() = runTest {
        // Given
        val suggestedTags = listOf("android", "unknown-tag", "kotlin")
        val allowedTags = listOf("android", "kotlin", "compose")

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod(
                "filterAndNormalizeTags",
                List::class.java,
                List::class.java
            )
            .apply { isAccessible = true }
            .invoke(geminiClient, suggestedTags, allowedTags) as List<*>

        // Then
        assertEquals(2, result.size)
        assertTrue(result.contains("android"))
        assertTrue(result.contains("kotlin"))
    }

    @Test
    fun `filterAndNormalizeTags respects max suggestions limit`() = runTest {
        // Given
        val suggestedTags = listOf("tag1", "tag2", "tag3", "tag4", "tag5",
                                    "tag6", "tag7", "tag8", "tag9", "tag10")
        val allowedTags = suggestedTags

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod(
                "filterAndNormalizeTags",
                List::class.java,
                List::class.java
            )
            .apply { isAccessible = true }
            .invoke(geminiClient, suggestedTags, allowedTags) as List<*>

        // Then - MAX_TAG_SUGGESTIONS is 8
        assertEquals(8, result.size)
    }

    @Test
    fun `filterAndNormalizeTags removes duplicates`() = runTest {
        // Given
        val suggestedTags = listOf("android", "Android", "ANDROID", "kotlin")
        val allowedTags = listOf("android", "kotlin")

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod(
                "filterAndNormalizeTags",
                List::class.java,
                List::class.java
            )
            .apply { isAccessible = true }
            .invoke(geminiClient, suggestedTags, allowedTags) as List<*>

        // Then
        assertEquals(2, result.size)
        assertTrue(result.contains("android"))
        assertTrue(result.contains("kotlin"))
    }

    @Test
    fun `buildTagSuggestionPrompt creates concise format`() = runTest {
        // Given
        val request = GeminiClient.TagSuggestionRequest(
            articleId = "123",
            title = "Understanding Kotlin Coroutines",
            description = "A comprehensive guide to asynchronous programming in Kotlin",
            url = null,
            availableTags = listOf("kotlin", "coroutines", "async", "programming")
        )

        // When
        val prompt = geminiClient.javaClass
            .getDeclaredMethod("buildTagSuggestionPrompt", GeminiClient.TagSuggestionRequest::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, request) as String

        // Then
        assertTrue(prompt.contains("Title: Understanding Kotlin Coroutines"))
        assertTrue(prompt.contains("Description: A comprehensive guide"))
        assertTrue(prompt.contains("Available tags: kotlin, coroutines, async, programming"))
        assertTrue(prompt.contains("Select up to 8 most relevant tags"))
    }

    @Test
    fun `buildTagSuggestionPrompt handles empty description`() = runTest {
        // Given
        val request = GeminiClient.TagSuggestionRequest(
            articleId = "123",
            title = "Test Article",
            description = null,
            url = null,
            availableTags = listOf("test", "kotlin")
        )

        // When
        val prompt = geminiClient.javaClass
            .getDeclaredMethod("buildTagSuggestionPrompt", GeminiClient.TagSuggestionRequest::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, request) as String

        // Then
        assertTrue(prompt.contains("Title: Test Article"))
        assertTrue(!prompt.contains("Description:"))
        assertTrue(prompt.contains("Available tags: test, kotlin"))
    }

    @Test
    fun `buildTagSuggestionPrompt handles empty tags list`() = runTest {
        // Given
        val request = GeminiClient.TagSuggestionRequest(
            articleId = "123",
            title = "Test Article",
            description = "Test description",
            url = null,
            availableTags = emptyList()
        )

        // When
        val prompt = geminiClient.javaClass
            .getDeclaredMethod("buildTagSuggestionPrompt", GeminiClient.TagSuggestionRequest::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, request) as String

        // Then
        assertTrue(prompt.contains("Available tags: none"))
    }

    @Test
    fun `buildArticleSummaryPrompt includes URL and title`() = runTest {
        // Given
        val request = GeminiClient.ArticleSummaryRequest(
            articleId = "123",
            title = "Test Article",
            url = "https://example.com/article"
        )

        // When
        val prompt = geminiClient.javaClass
            .getDeclaredMethod("buildArticleSummaryPrompt", GeminiClient.ArticleSummaryRequest::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, request) as String

        // Then
        assertTrue(prompt.contains("Use urlcontext to read the article"))
        assertTrue(prompt.contains("Article title: Test Article"))
        assertTrue(prompt.contains("Article URL: https://example.com/article"))
        assertTrue(prompt.contains("Generate a concise editorial summary"))
        assertTrue(prompt.contains("Return ONLY the summary text"))
    }

    @Test
    fun `cleanJsonResponse removes markdown code fences`() = runTest {
        // Given
        val input = """```json
{
  "tags": ["android", "kotlin"]
}
```"""

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod("cleanJsonResponse", String::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, input) as String

        // Then
        val expected = """{
  "tags": ["android", "kotlin"]
}"""
        assertEquals(expected, result)
    }

    @Test
    fun `cleanJsonResponse handles JSON without code fences`() = runTest {
        // Given
        val input = """{"tags": ["android", "kotlin"]}"""

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod("cleanJsonResponse", String::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, input) as String

        // Then
        assertEquals(input, result)
    }

    @Test
    fun `cleanJsonResponse handles code fence without json language marker`() = runTest {
        // Given
        val input = """```
{"tags": ["android"]}
```"""

        // When
        val result = geminiClient.javaClass
            .getDeclaredMethod("cleanJsonResponse", String::class.java)
            .apply { isAccessible = true }
            .invoke(geminiClient, input) as String

        // Then
        assertEquals("""{"tags": ["android"]}""", result)
    }

    // Result type tests
    @Test
    fun `TagSuggestionResult Success contains tags`() {
        // Given
        val tags = listOf("kotlin", "android", "compose")

        // When
        val result = GeminiClient.TagSuggestionResult.Success(tags)

        // Then
        assertEquals(tags, result.tags)
    }

    @Test
    fun `TagSuggestionResult Error contains message and cause`() {
        // Given
        val message = "API Error"
        val cause = RuntimeException("Network failure")

        // When
        val result = GeminiClient.TagSuggestionResult.Error(message, cause)

        // Then
        assertEquals(message, result.message)
        assertEquals(cause, result.cause)
    }

    @Test
    fun `ArticleSummaryResult Success contains summary`() {
        // Given
        val summary = "This is a test summary of the article content."

        // When
        val result = GeminiClient.ArticleSummaryResult.Success(summary)

        // Then
        assertEquals(summary, result.summary)
    }

    @Test
    fun `ArticleSummaryResult Error contains message`() {
        // Given
        val message = "Failed to fetch summary"

        // When
        val result = GeminiClient.ArticleSummaryResult.Error(message)

        // Then
        assertEquals(message, result.message)
    }
}