package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.data.archive.ArchiveRetryAnswer
import com.jayteealao.trails.data.archive.RetryFailure
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update

/** The retry of one article beside its last status, so one update reads and moves both. */
internal data class ArticleRetry(
    val retry: ArchiveRetryState = ArchiveRetryState.Idle,
    val status: String? = null,
)

/**
 * The archive retries of the articles opened in one screen, kept per article, so a switch to
 * another article and back does not free a pending request. Each move is one atomic update.
 */
internal class ArchiveRetries {

    private val entries = MutableStateFlow<Map<String, ArticleRetry>>(emptyMap())

    val all: StateFlow<Map<String, ArticleRetry>> = entries.asStateFlow()

    fun onReopen(itemId: String) = change(itemId) { it.copy(retry = it.retry.onReopen()) }

    fun onStatus(itemId: String, status: String?) =
        change(itemId) { ArticleRetry(it.retry.onStatus(status), status) }

    fun onOnline(itemId: String) = change(itemId) { it.copy(retry = it.retry.onOnline()) }

    fun onAnswer(itemId: String, answer: ArchiveRetryAnswer) =
        change(itemId) { it.copy(retry = it.retry.onAnswer(answer, it.status)) }

    /**
     * Applies a tap on Try again of [itemId]. Returns true only for the tap that moved the state
     * to Sending, which is the one that must send the request.
     */
    fun tap(itemId: String, online: Boolean): Boolean {
        val before = entries.getAndUpdate { it.changed(itemId) { entry -> entry.copy(retry = entry.tapped(online)) } }
        val entry = before[itemId] ?: ArticleRetry()
        return entry.retry !is ArchiveRetryState.Sending && entry.tapped(online) is ArchiveRetryState.Sending
    }

    private fun ArticleRetry.tapped(online: Boolean): ArchiveRetryState {
        val tapped = retry.onTap(status)
        val sends = tapped is ArchiveRetryState.Sending && retry !is ArchiveRetryState.Sending
        return if (sends && !online) ArchiveRetryState.NotSent(RetryFailure.OFFLINE) else tapped
    }

    private fun change(itemId: String, change: (ArticleRetry) -> ArticleRetry) {
        entries.update { it.changed(itemId, change) }
    }

    /** This map with the entry of [itemId] changed; an article with nothing to keep gets no entry. */
    private fun Map<String, ArticleRetry>.changed(
        itemId: String,
        change: (ArticleRetry) -> ArticleRetry,
    ): Map<String, ArticleRetry> {
        val before = this[itemId] ?: ArticleRetry()
        val after = change(before)
        return if (after == before) this else this + (itemId to after)
    }
}
