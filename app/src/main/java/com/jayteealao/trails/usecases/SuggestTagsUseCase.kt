package com.jayteealao.trails.usecases

import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.services.gemini.GeminiService
import javax.inject.Inject
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

class SuggestTagsUseCase @Inject constructor(
    private val geminiService: GeminiService,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher,
) {

    data class Request(
        val articleId: String,
        val title: String,
        val description: String?,
        val url: String?,
        val availableTags: List<String>,
    )

    data class Suggestion(
        val tags: List<String>,
        val summary: String,
        val lede: String,
        val faviconUrl: String?,
        val imageUrls: List<String>,
        val videoUrls: List<String>,
    )

    sealed class Result {
        data class Success(val suggestion: Suggestion) : Result()
        data class Error(val message: String, val cause: Throwable? = null) : Result()
        data class MissingCredentials(val message: String) : Result()
    }

    suspend operator fun invoke(request: Request): Result = withContext(ioDispatcher) {
        try {
            val serviceRequest = GeminiService.TagSuggestionRequest(
                articleId = request.articleId,
                title = request.title,
                description = request.description,
                url = request.url,
                availableTags = request.availableTags,
            )
            val suggestion = geminiService.fetchTagSuggestions(serviceRequest)
            Result.Success(
                Suggestion(
                    tags = suggestion.tags,
                    summary = suggestion.summary,
                    lede = suggestion.lede,
                    faviconUrl = suggestion.faviconUrl,
                    imageUrls = suggestion.imageUrls,
                    videoUrls = suggestion.videoUrls,
                )
            )
        } catch (missing: GeminiService.MissingFirebaseCredentialsException) {
            Result.MissingCredentials(missing.message ?: DEFAULT_MISSING_MESSAGE)
        } catch (error: Exception) {
            Result.Error(error.message ?: GENERIC_ERROR, error)
        }
    }

    private companion object {
        private const val DEFAULT_MISSING_MESSAGE = "Firebase AI credentials are not configured."
        private const val GENERIC_ERROR = "Unable to fetch suggestions from Gemini."
    }
}
