package com.jayteealao.trails.common

import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.ceil

@Singleton
class ContentMetricsCalculator @Inject constructor() {

    companion object{// Average reading speed (words per minute)
        private const val AVERAGE_READING_SPEED_WPM = 218
        // Average speaking speed (words per minute)
        private const val AVERAGE_SPEAKING_SPEED_WPM = 150
        // Minimum read time to show (in minutes)
        private const val MIN_READ_TIME = 1
    }

    data class ContentMetrics(
        val wordCount: Int,
        val characterCount: Int,
        val readingTimeMinutes: Int,
        val listeningTimeMinutes: Int
    )

    fun calculateMetrics(markdownText: String): ContentMetrics {
        // Remove markdown syntax
        val cleanText = removeMarkdownSyntax(markdownText)

        // Calculate word count
        val words = cleanText
            .trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }

        val wordCount = words.size

        // Calculate character count (excluding whitespace)
        val characterCount = cleanText.replace(Regex("\\s+"), "").length

        // Calculate reading time
        val readingTimeMinutes = maxOf(
            MIN_READ_TIME,
            ceil(wordCount.toFloat() / AVERAGE_READING_SPEED_WPM).toInt()
        )

        // Calculate listening time
        val listeningTimeMinutes = maxOf(
            MIN_READ_TIME,
            ceil(wordCount.toFloat() / AVERAGE_SPEAKING_SPEED_WPM).toInt()
        )

        return ContentMetrics(
            wordCount = wordCount,
            characterCount = characterCount,
            readingTimeMinutes = readingTimeMinutes,
            listeningTimeMinutes = listeningTimeMinutes
        )
    }

    private fun removeMarkdownSyntax(markdownText: String): String {
        return markdownText
            // Remove code blocks
            .replace(Regex("```[\\s\\S]*?```"), "")
            // Remove inline code
            .replace(Regex("`[^`]+`"), "")
            // Remove headers
            .replace(Regex("#{1,6}\\s.*"), "")
            // Remove bold/italic
            .replace(Regex("\\*\\*.*?\\*\\*"), "")
            .replace(Regex("__.*?__"), "")
            .replace(Regex("\\*.*?\\*"), "")
            .replace(Regex("_.*?_"), "")
            // Remove links
            .replace(Regex("\\[([^\\]]+)\\]\\([^)]+\\)"), "$1")
            // Remove images
            .replace(Regex("!\\[([^\\]]+)\\]\\([^)]+\\)"), "")
            // Remove blockquotes
            .replace(Regex("^>\\s.*$", RegexOption.MULTILINE), "")
            // Remove horizontal rules
            .replace(Regex("^-{3,}$", RegexOption.MULTILINE), "")
            // Remove HTML tags
            .replace(Regex("<[^>]+>"), "")
            // Normalize whitespace
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    fun formatDuration(minutes: Int): String {
        return when {
            minutes < 1 -> "Less than a minute"
            minutes == 1 -> "1 minute"
            else -> "$minutes minutes"
        }
    }
}