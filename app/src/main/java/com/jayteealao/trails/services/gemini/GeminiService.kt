package com.jayteealao.trails.services.gemini

import android.content.Context
import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.Content
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Tool
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.services.gemini.GeminiService.MissingFirebaseCredentialsException
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber

@Singleton
class GeminiService @Inject constructor(
    private val sharedPreferencesManager: SharedPreferencesManager,
    @ApplicationContext private val context: Context,
) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val appMutex = Mutex()

    suspend fun fetchTagSuggestions(request: TagSuggestionRequest): GeminiTagSuggestion {
        val app = ensureFirebaseApp() ?: throw MissingFirebaseCredentialsException()

        return runCatching {
            val backend = GenerativeBackend.googleAI()
            val systemInstruction = buildSystemInstruction()
            val model = Firebase.ai(app, backend).generativeModel(
                modelName = MODEL_NAME,
                generationConfig = generationConfig {
                    temperature = 0.35f
                    topK = 32
                    topP = 0.85f
                    maxOutputTokens = 768
                    responseMimeType = "application/json"
                },
                tools = buildTools(request),
                systemInstruction = systemInstruction,
            )

            val response = model.generateContent(
                content {
                    text(buildUserPrompt(request))
                }
            )

            val raw = response.text ?: throw GeminiServiceException("Gemini returned an empty response")
            val payload = json.decodeFromString<GeminiStructuredResponse>(raw)
            payload.toSuggestion(request.availableTags)
        }.getOrElse { throwable ->
            if (throwable is MissingFirebaseCredentialsException) throw throwable
            throw GeminiServiceException("Failed to fetch Gemini suggestions", throwable)
        }
    }

    private suspend fun ensureFirebaseApp(): FirebaseApp? = appMutex.withLock {
        val existing = FirebaseApp.getApps(context)
            .firstOrNull { it.name == FIREBASE_APP_NAME }
        if (existing != null) return existing

        val apiKey = sharedPreferencesManager.getString(FIREBASE_API_KEY)?.takeUnless { it.isBlank() }
        val projectId = sharedPreferencesManager.getString(FIREBASE_PROJECT_ID)?.takeUnless { it.isBlank() }
        val applicationId = sharedPreferencesManager.getString(FIREBASE_APPLICATION_ID)
            ?.takeUnless { it.isBlank() }
            ?: context.packageName

        if (apiKey == null || projectId == null) {
            Timber.w("Firebase AI credentials are missing – unable to initialize Gemini")
            return null
        }

        val options = FirebaseOptions.Builder()
            .setApiKey(apiKey)
            .setProjectId(projectId)
            .setApplicationId(applicationId)
            .build()

        return FirebaseApp.initializeApp(context, options, FIREBASE_APP_NAME)
    }

    private fun buildSystemInstruction(): Content = content(role = "system") {
        text(
            """
            You are an editorial assistant helping organise saved reading lists. All responses must strictly be valid JSON.
            Never emit explanations or markdown outside of the JSON object.
            """.trimIndent()
        )
    }

    @OptIn(PublicPreviewAPI::class)
    private fun buildTools(request: TagSuggestionRequest): List<Tool> {
        return if (request.url.isNullOrBlank()) {
            emptyList()
        } else {
            listOf(Tool.urlContext())
        }
    }

    private fun buildUserPrompt(request: TagSuggestionRequest): String {
        val allowedTags = if (request.availableTags.isEmpty()) "(no tags available)" else request.availableTags.joinToString(
            separator = "\n"
        ) { "- $it" }
        return buildString {
            appendLine("Use urlcontext to read the provided article when a URL exists before drafting your answer.")
            appendLine("Article title: ${request.title.trim()}")
            request.url?.takeIf { it.isNotBlank() }?.let { appendLine("Article URL: $it") }
            request.description?.takeIf { it.isNotBlank() }?.let { appendLine("Article description: ${it.trim()}") }
            appendLine()
            appendLine("Allowed tags (only choose from this list, max 8 items):")
            appendLine(allowedTags)
            appendLine()
            appendLine("Return JSON with the structure:")
            appendLine("{")
            appendLine("  \"tags\": [tag strings drawn only from the allowed tags list],")
            appendLine("  \"favicon_url\": string|null,")
            appendLine("  \"image_urls\": [unique image URLs],")
            appendLine("  \"video_urls\": [unique video URLs],")
            appendLine("  \"summary\": editorial paragraph that never begins with The/This/These/Those/That,")
            appendLine("  \"lede\": concise hook sentence that also avoids starting with definitive determiners")
            appendLine("}")
            appendLine("If a field has no value, return null for single values or an empty array for lists.")
            appendLine("Ensure the summary reads like it belongs in a magazine blurb and does not start with a definitive article.")
        }
    }

    private fun GeminiStructuredResponse.toSuggestion(allowedTags: List<String>): GeminiTagSuggestion {
        val normalizedAllowed = allowedTags.associateBy { it.trim().lowercase(Locale.US) }
        val filteredTags = tags.orEmpty()
            .mapNotNull { candidate ->
                val key = candidate.trim().lowercase(Locale.US)
                normalizedAllowed[key]
            }
            .distinct()
            .take(MAX_TAG_SUGGESTIONS)
        return GeminiTagSuggestion(
            tags = filteredTags,
            summary = summary?.let(::sanitizeEditorialLine).orEmpty(),
            lede = lede?.let(::sanitizeEditorialLine).orEmpty(),
            faviconUrl = faviconUrl?.takeUnless { it.isBlank() },
            imageUrls = imageUrls?.filterNot { it.isBlank() }?.distinct().orEmpty(),
            videoUrls = videoUrls?.filterNot { it.isBlank() }?.distinct().orEmpty(),
        )
    }

    private fun sanitizeEditorialLine(line: String): String {
        val trimmed = line.trim()
        if (trimmed.isEmpty()) return trimmed

        val tokens = trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return trimmed

        var firstValidIndex = 0
        while (firstValidIndex < tokens.size) {
            val candidate = tokens[firstValidIndex]
            val normalized = candidate
                .trimStart(*LEADING_PUNCTUATION)
                .lowercase(Locale.US)
            if (normalized.isEmpty()) {
                firstValidIndex++
                continue
            }
            if (normalized in BANNED_LEADS) {
                firstValidIndex++
                continue
            }
            break
        }

        if (firstValidIndex >= tokens.size) {
            return trimmed
        }

        val remaining = tokens.drop(firstValidIndex).toMutableList()
        if (remaining.isEmpty()) return trimmed

        remaining[0] = remaining.first().trimStart(*LEADING_PUNCTUATION)
        val rebuilt = remaining.joinToString(" ").trim()
        if (rebuilt.isEmpty()) return trimmed

        return rebuilt.replaceFirstChar { char ->
            if (char.isLowerCase()) char.titlecase(Locale.US) else char.toString()
        }
    }

    data class TagSuggestionRequest(
        val articleId: String,
        val title: String,
        val description: String?,
        val url: String?,
        val availableTags: List<String>,
    )

    data class GeminiTagSuggestion(
        val tags: List<String>,
        val summary: String,
        val lede: String,
        val faviconUrl: String?,
        val imageUrls: List<String>,
        val videoUrls: List<String>,
    )

    class MissingFirebaseCredentialsException : IllegalStateException(
        "Firebase AI credentials (api key and project id) must be set before requesting Gemini suggestions."
    )

    class GeminiServiceException(message: String, cause: Throwable? = null) : Exception(message, cause)

    @Serializable
    private data class GeminiStructuredResponse(
        val tags: List<String>? = emptyList(),
        @SerialName("favicon_url") val faviconUrl: String? = null,
        @SerialName("image_urls") val imageUrls: List<String>? = emptyList(),
        @SerialName("video_urls") val videoUrls: List<String>? = emptyList(),
        val summary: String? = null,
        val lede: String? = null,
    )

    companion object {
        private const val MODEL_NAME = "gemini-2.5-flash"
        private const val FIREBASE_APP_NAME = "trails-gemini"
        private const val FIREBASE_API_KEY = "FIREBASE_GEMINI_API_KEY"
        private const val FIREBASE_PROJECT_ID = "FIREBASE_GEMINI_PROJECT_ID"
        private const val FIREBASE_APPLICATION_ID = "FIREBASE_GEMINI_APPLICATION_ID"
        private const val MAX_TAG_SUGGESTIONS = 8
        private val BANNED_LEADS = setOf("the", "this", "these", "those", "that")
        private val LEADING_PUNCTUATION = charArrayOf(
            '\'',
            '"',
            '\u201c', // “
            '\u201d', // ”
            '\u201e', // „
            '\u00ab', // «
            '\u2039', // ‹
            '\u2018', // ‘
            '\u2019', // ’
            '(',
            '[',
            '{'
        )
    }
}

