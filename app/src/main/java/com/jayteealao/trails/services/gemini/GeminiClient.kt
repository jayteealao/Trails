package com.jayteealao.trails.services.gemini

import com.google.firebase.Firebase
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.Content
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.Tool
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GeminiClient @Inject constructor() {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val modelMutex = Mutex()
    private val cachedModels = mutableMapOf<ModelKey, GenerativeModel>()
    private val systemInstruction: Content by lazy { buildSystemInstruction() }

    // Define response schema for tag suggestions
    private val tagSuggestionSchema = Schema.obj(
        mapOf("tags" to Schema.array(Schema.string()))
    )

    /**
     * Fetches tag suggestions for an article using structured JSON output.
     * This method does NOT use URL context - it relies on the provided title and description.
     * If an article has no description, call fetchArticleSummary first to generate one.
     */
    suspend fun fetchTagSuggestions(request: TagSuggestionRequest): TagSuggestionResult {
//        Timber.d("fetchTagSuggestions: Starting for article ${request.articleId}")
//        Timber.d("fetchTagSuggestions: Title=${request.title}")
//        Timber.d("fetchTagSuggestions: Description=${request.description?.take(100)}")
//        Timber.d("fetchTagSuggestions: Available tags count=${request.availableTags.size}")

        return runCatching {
//            Timber.d("fetchTagSuggestions: Getting generative model (no URL context, structured JSON)...")
            val model = getStructuredTagSuggestionModel()
//            Timber.d("fetchTagSuggestions: Model obtained successfully")

            val prompt = buildTagSuggestionPrompt(request)
//            Timber.d("fetchTagSuggestions: Prompt built (${prompt.length} chars)")
//            Timber.d("fetchTagSuggestions: Calling generateContent...")

            val response = model.generateContent(
                content {
                    text(prompt)
                }
            )

//            Timber.d("fetchTagSuggestions: Response received")
            val raw = response.text ?: throw GeminiClientException("Gemini returned an empty response")
//            Timber.d("fetchTagSuggestions: Response text length=${raw.length}")
//            Timber.d("fetchTagSuggestions: Response text=$raw")

            // With structured JSON, we get pure JSON (no markdown fences)
            val payload = json.decodeFromString<TagSuggestionResponse>(raw)
//            Timber.d("fetchTagSuggestions: JSON parsed, tags=${payload.tags}")

            val tags = filterAndNormalizeTags(payload.tags.orEmpty(), request.availableTags)
//            Timber.d("fetchTagSuggestions: Filtered tags count=${tags.size}, tags=$tags")

            TagSuggestionResult.Success(tags)
        }.getOrElse { throwable ->
            Timber.e(throwable, "Failed to fetch Gemini tag suggestions")
//            Timber.e("fetchTagSuggestions: Error type=${throwable::class.simpleName}")
//            Timber.e("fetchTagSuggestions: Error message=${throwable.message}")
            TagSuggestionResult.Error(
                message = throwable.message ?: "Failed to fetch tag suggestions",
                cause = throwable
            )
        }
    }

    /**
     * Fetches a summary for an article by reading its URL content.
     * This method uses URL context tool to read the article, then generates an editorial summary.
     * The summary can then be saved and used for tag suggestions.
     */
    suspend fun fetchArticleSummary(request: ArticleSummaryRequest): ArticleSummaryResult {
//        Timber.d("fetchArticleSummary: Starting for article ${request.articleId}")
//        Timber.d("fetchArticleSummary: Title=${request.title}")
//        Timber.d("fetchArticleSummary: URL=${request.url}")

        return runCatching {
//            Timber.d("fetchArticleSummary: Getting generative model (with URL context)...")
            val model = getGenerativeModel(useUrlContext = true)
//            Timber.d("fetchArticleSummary: Model obtained successfully")

            val prompt = buildArticleSummaryPrompt(request)
//            Timber.d("fetchArticleSummary: Prompt built (${prompt.length} chars)")
//            Timber.d("fetchArticleSummary: Calling generateContent...")

            val response = model.generateContent(
                content {
                    text(prompt)
                }
            )

//            Timber.d("fetchArticleSummary: Response received")
            val raw = response.text ?: throw GeminiClientException("Gemini returned an empty response")
//            Timber.d("fetchArticleSummary: Response text length=${raw.length}")

            // Clean response - system instructions should guide to return plain text summary
            val summary = raw.trim()
//            Timber.d("fetchArticleSummary: Summary generated (${summary.length} chars)")

            ArticleSummaryResult.Success(summary)
        }.getOrElse { throwable ->
//            Timber.e(throwable, "Failed to fetch article summary")
//            Timber.e("fetchArticleSummary: Error type=${throwable::class.simpleName}")
//            Timber.e("fetchArticleSummary: Error message=${throwable.message}")
            ArticleSummaryResult.Error(
                message = throwable.message ?: "Failed to fetch article summary",
                cause = throwable
            )
        }
    }

    suspend fun fetchEditorialContent(request: EditorialContentRequest): EditorialContentResult {
        val useUrlContext = !request.url.isNullOrBlank()

        return runCatching {
            val model = getGenerativeModel(useUrlContext)

            val response = model.generateContent(
                content {
                    text(buildEditorialContentPrompt(request))
                }
            )

            val raw = response.text ?: throw GeminiClientException("Gemini returned an empty response")

            // Strip markdown code fences if present (happens when tools are used)
            val cleanedJson = cleanJsonResponse(raw)

            val payload = json.decodeFromString<EditorialContentResponse>(cleanedJson)
            EditorialContentResult.Success(
                EditorialContent(
                    summary = payload.summary.orEmpty(),
                    lede = payload.lede.orEmpty(),
                    faviconUrl = payload.faviconUrl?.takeUnless { it.isBlank() },
                    imageUrls = payload.imageUrls?.filterNot { it.isBlank() }?.distinct().orEmpty(),
                    videoUrls = payload.videoUrls?.filterNot { it.isBlank() }?.distinct().orEmpty()
                )
            )
        }.getOrElse { throwable ->
            Timber.e(throwable, "Failed to fetch Gemini editorial content")
            EditorialContentResult.Error(
                message = throwable.message ?: "Failed to fetch editorial content",
                cause = throwable
            )
        }
    }

    private fun buildSystemInstruction(): Content = content(role = "system") {
//        Timber.d("buildSystemInstruction: Building system instruction")
        text(
            """
            You are an editorial assistant helping organise saved reading lists. All responses must strictly be valid JSON.
            Never emit explanations or markdown outside of the JSON object.
            """.trimIndent()
        )
    }

    @OptIn(PublicPreviewAPI::class)
    private suspend fun getGenerativeModel(
        useUrlContext: Boolean,
    ): GenerativeModel = modelMutex.withLock {
//        Timber.d("getGenerativeModel: Checking cache for useUrlContext=$useUrlContext")
        val key = ModelKey(useUrlContext, useSchema = false)
        cachedModels[key]?.let {
//            Timber.d("getGenerativeModel: Returning cached model")
            return it
        }

//        Timber.d("getGenerativeModel: Creating new model instance")
        val tools = if (useUrlContext) {
//            Timber.d("getGenerativeModel: Adding URL context tool")
            listOf(Tool.urlContext())
        } else {
//            Timber.d("getGenerativeModel: No tools")
            emptyList()
        }

//        Timber.d("getGenerativeModel: Model name=$MODEL_NAME")
//        Timber.d("getGenerativeModel: Creating Firebase.ai instance...")

        try {
            val model = Firebase.ai(
                backend = GenerativeBackend.googleAI()
            ).generativeModel(
                modelName = MODEL_NAME,
                generationConfig = generationConfig {
                    temperature = 0.35f
                    topK = 32
                    topP = 0.85f
//                    maxOutputTokens = 768
                    // responseMimeType cannot be used with tools, so only set it when tools are empty
                    if (!useUrlContext) {
                        responseMimeType = "application/json"
                    }
                },
                tools = tools,
                systemInstruction = systemInstruction,
            )

//            Timber.d("getGenerativeModel: Model created successfully")
            cachedModels[key] = model
            return model
        } catch (e: Exception) {
            Timber.e(e, "getGenerativeModel: Failed to create model")
            throw e
        }
    }

    /**
     * Gets a GenerativeModel specifically configured for tag suggestions with structured JSON schema.
     * This model doesn't use URL context, allowing us to use responseSchema for guaranteed JSON structure.
     */
    @OptIn(PublicPreviewAPI::class)
    private suspend fun getStructuredTagSuggestionModel(): GenerativeModel = modelMutex.withLock {
        val key = ModelKey(useUrlContext = false, useSchema = true)
        cachedModels[key]?.let {
//            Timber.d("getStructuredTagSuggestionModel: Returning cached model")
            return it
        }

//        Timber.d("getStructuredTagSuggestionModel: Creating new model with responseSchema")

        try {
            val model = Firebase.ai(
                backend = GenerativeBackend.googleAI()
            ).generativeModel(
                modelName = MODEL_NAME,
                generationConfig = generationConfig {
                    temperature = 0.35f
                    topK = 32
                    topP = 0.85f
                    maxOutputTokens = 30000  // Reduced - we only need a simple JSON array
                    responseMimeType = "application/json"
                    responseSchema = tagSuggestionSchema
                },
                // No tools when using responseSchema
                tools = emptyList(),
                systemInstruction = systemInstruction,
            )

//            Timber.d("getStructuredTagSuggestionModel: Model created successfully with schema")
            cachedModels[key] = model
            return model
        } catch (e: Exception) {
            Timber.e(e, "getStructuredTagSuggestionModel: Failed to create model")
            throw e
        }
    }

    private fun buildTagSuggestionPrompt(request: TagSuggestionRequest): String {
        // Limit tag list to prevent token overflow
//        val limitedTags = if (request.availableTags.size > MAX_TAGS_IN_PROMPT) {
//            Timber.d("buildTagSuggestionPrompt: Limiting tags from ${request.availableTags.size} to $MAX_TAGS_IN_PROMPT")
//            request.availableTags.take(MAX_TAGS_IN_PROMPT)
//        } else {
//            request.availableTags
//        }

        val allowedTags = if (request.availableTags.isEmpty()) {
            "none"
        } else {
            request.availableTags.joinToString(", ")
        }

        return buildString {
            appendLine("Title: ${request.title.trim()}")
            request.description?.takeIf { it.isNotBlank() }?.let {
                // Limit description to 500 chars to reduce token usage
                appendLine("Description: $it")
            }
            appendLine()
            appendLine("Available tags: $allowedTags")
            appendLine()
            appendLine("Select up to ${MAX_TAG_SUGGESTIONS} most relevant tags.")
        }
    }

    private fun buildArticleSummaryPrompt(request: ArticleSummaryRequest): String {
        return buildString {
            appendLine("Use urlcontext to read the article at the provided URL.")
            appendLine()
            appendLine("Article title: ${request.title.trim()}")
            appendLine("Article URL: ${request.url}")
            appendLine()
            appendLine("Generate a concise editorial summary (2-3 sentences) of the article's main content.")
            appendLine("The summary should:")
            appendLine("- Be informative and capture the key points")
            appendLine("- Never begin with definitive articles (The, This, These, Those, That)")
            appendLine("- Be suitable for a reading list description")
            appendLine("- Return ONLY the summary text, no JSON, no markdown, no extra formatting")
        }
    }

    private fun buildEditorialContentPrompt(request: EditorialContentRequest): String {
        return buildString {
            appendLine("Use urlcontext to read the provided article when a URL exists before drafting your answer.")
            appendLine("Article title: ${request.title.trim()}")
            request.url?.takeIf { it.isNotBlank() }?.let { appendLine("Article URL: $it") }
            request.description?.takeIf { it.isNotBlank() }?.let { appendLine("Article description: ${it.trim()}") }
            appendLine()
            appendLine("Return JSON with the structure:")
            appendLine("{")
            appendLine("  \"summary\": editorial paragraph that never begins with The/This/These/Those/That,")
            appendLine("  \"lede\": concise hook sentence that also avoids starting with definitive determiners,")
            appendLine("  \"favicon_url\": string|null,")
            appendLine("  \"image_urls\": [unique image URLs],")
            appendLine("  \"video_urls\": [unique video URLs]")
            appendLine("}")
            appendLine("If a field has no value, return null for single values or an empty array for lists.")
            appendLine("Ensure the summary reads like it belongs in a magazine blurb and does not start with a definitive article.")
        }
    }

    private fun filterAndNormalizeTags(tags: List<String>, allowedTags: List<String>): List<String> {
        val normalizedAllowed = allowedTags.associateBy { it.trim().lowercase(Locale.US) }
        return tags
            .mapNotNull { candidate ->
                val key = candidate.trim().lowercase(Locale.US)
                normalizedAllowed[key]
            }
            .distinct()
            .take(MAX_TAG_SUGGESTIONS)
    }

    /**
     * Cleans JSON responses that may be wrapped in markdown code fences.
     * When using tools with Gemini, responses may come as ```json ... ``` instead of pure JSON.
     */
    private fun cleanJsonResponse(raw: String): String {
        val trimmed = raw.trim()

        // Check if wrapped in markdown code fences
        val jsonCodeFenceRegex = Regex("^```(?:json)?\\s*\\n(.*)\\n```$", RegexOption.DOT_MATCHES_ALL)
        val match = jsonCodeFenceRegex.find(trimmed)

        return if (match != null) {
            // Extract content between code fences
            match.groupValues[1].trim()
        } else {
            // Return as-is if no code fences found
            trimmed
        }
    }

//    /**
//     * This
//     */
//    private fun sanitizeEditorialLine(line: String): String {
//        val trimmed = line.trim()
//        if (trimmed.isEmpty()) return trimmed
//
//        val tokens = trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() }
//        if (tokens.isEmpty()) return trimmed
//
//        var firstValidIndex = 0
//        while (firstValidIndex < tokens.size) {
//            val candidate = tokens[firstValidIndex]
//            val normalized = candidate
//                .trimStart(*LEADING_PUNCTUATION)
//                .lowercase(Locale.US)
//            if (normalized.isEmpty()) {
//                firstValidIndex++
//                continue
//            }
//            if (normalized in BANNED_LEADS) {
//                firstValidIndex++
//                continue
//            }
//            break
//        }
//
//        if (firstValidIndex >= tokens.size) {
//            return trimmed
//        }
//
//        val remaining = tokens.drop(firstValidIndex).toMutableList()
//        if (remaining.isEmpty()) return trimmed
//
//        remaining[0] = remaining.first().trimStart(*LEADING_PUNCTUATION)
//        val rebuilt = remaining.joinToString(" ").trim()
//        if (rebuilt.isEmpty()) return trimmed
//
//        return rebuilt.replaceFirstChar { char ->
//            if (char.isLowerCase()) char.titlecase(Locale.US) else char.toString()
//        }
//    }

    data class TagSuggestionRequest(
        val articleId: String,
        val title: String,
        val description: String?,
        val url: String?,
        val availableTags: List<String>,
    )

    data class ArticleSummaryRequest(
        val articleId: String,
        val title: String,
        val url: String,
    )

    data class EditorialContentRequest(
        val articleId: String,
        val title: String,
        val description: String?,
        val url: String?,
    )

    data class EditorialContent(
        val summary: String,
        val lede: String,
        val faviconUrl: String?,
        val imageUrls: List<String>,
        val videoUrls: List<String>,
    )

    sealed class TagSuggestionResult {
        data class Success(val tags: List<String>) : TagSuggestionResult()
        data class Error(val message: String, val cause: Throwable? = null) : TagSuggestionResult()
    }

    sealed class ArticleSummaryResult {
        data class Success(val summary: String) : ArticleSummaryResult()
        data class Error(val message: String, val cause: Throwable? = null) : ArticleSummaryResult()
    }

    sealed class EditorialContentResult {
        data class Success(val content: EditorialContent) : EditorialContentResult()
        data class Error(val message: String, val cause: Throwable? = null) : EditorialContentResult()
    }

    class GeminiClientException(message: String, cause: Throwable? = null) : Exception(message, cause)

    @Serializable
    private data class TagSuggestionResponse(
        val tags: List<String>? = emptyList(),
    )

    @Serializable
    private data class EditorialContentResponse(
        val summary: String? = null,
        val lede: String? = null,
        @SerialName("favicon_url") val faviconUrl: String? = null,
        @SerialName("image_urls") val imageUrls: List<String>? = emptyList(),
        @SerialName("video_urls") val videoUrls: List<String>? = emptyList(),
    )

    private data class ModelKey(val useUrlContext: Boolean, val useSchema: Boolean = false)

    companion object {
        private const val MODEL_NAME = "gemini-2.5-flash"
        private const val MAX_TAG_SUGGESTIONS = 8
//        private const val MAX_TAGS_IN_PROMPT = 100  // Limit tags to prevent token overflow
        private val BANNED_LEADS = setOf("the", "this", "these", "those", "that")
        private val LEADING_PUNCTUATION = charArrayOf(
            '\'',
            '"',
            '\u201c', // "
            '\u201d', // "
            '\u201e', // „
            '\u00ab', // «
            '\u2039', // ‹
            '\u2018', // '
            '\u2019', // '
            '(',
            '[',
            '{'
        )
    }
}
