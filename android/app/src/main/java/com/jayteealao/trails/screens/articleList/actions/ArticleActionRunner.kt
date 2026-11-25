package com.jayteealao.trails.screens.articleList.actions

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.components.ErrorMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber

/** The open actions sheet: its article, the line of the last failure, and whether its details load. */
data class ArticleSheet(
    val article: ArticleItem,
    val failure: String? = null,
    val regenerating: Boolean = false,
)

/** What an action tells the screen, once. */
sealed interface ArticleActionEvent {
    data class Say(val message: String) : ArticleActionEvent
    data class Failed(val message: ErrorMessage, val retry: (() -> Unit)? = null) : ArticleActionEvent
    data class Deleted(val undo: () -> Unit) : ArticleActionEvent
    data class Share(val title: String, val url: String) : ArticleActionEvent
    data class Copy(val url: String) : ArticleActionEvent
    data class Open(val url: String) : ArticleActionEvent
}

/** A change of one article on this phone. */
sealed interface ArticleChange {
    val itemId: String

    data class Favourite(override val itemId: String, val isFavorite: Boolean) : ArticleChange
    data class Read(override val itemId: String, val isRead: Boolean) : ArticleChange
    data class Archive(override val itemId: String) : ArticleChange
    data class Delete(override val itemId: String) : ArticleChange
    data class Restore(override val itemId: String) : ArticleChange
}

/**
 * Runs the actions of the rows of one screen, and holds its actions sheet. The swipe, the star and
 * the screen reader actions use [run]; the sheet uses [choose], which keeps the sheet open until a
 * change is saved, so a failure is told where it was chosen.
 *
 * @param onSaved called after a change reached the database.
 * @param onDetails called after the details of an article were read again and stored.
 */
class ArticleActionRunner(
    private val repository: ArticleRepository,
    private val scope: CoroutineScope,
    private val dispatcher: CoroutineDispatcher,
    private val refreshDetails: suspend (itemId: String) -> DetailsRefresh,
    private val emit: suspend (ArticleActionEvent) -> Unit,
    private val onSaved: (ArticleChange) -> Unit = {},
    private val onDetails: (itemId: String, details: DetailsRefresh.Updated) -> Unit = { _, _ -> },
) {
    /** One value, so an answer that arrives while a sheet opens cannot be lost between two. */
    private data class State(
        val article: ArticleItem? = null,
        val failure: String? = null,
        val saving: Set<String> = emptySet(),
        val regenerating: Set<String> = emptySet(),
    )

    private val state = MutableStateFlow(State())

    /** The open sheet, or null. */
    val sheet: Flow<ArticleSheet?> = state
        .map { s -> s.article?.let { ArticleSheet(it, s.failure, it.itemId in s.regenerating) } }
        .distinctUntilChanged()

    fun openSheet(article: ArticleItem) = state.update { it.copy(article = article, failure = null) }

    fun closeSheet() = state.update { it.copy(article = null, failure = null) }

    /** Runs [action] of [article], which is the article as its row shows it. */
    fun run(action: ArticleAction, article: ArticleItem) {
        when (action) {
            ArticleAction.FAVOURITE, ArticleAction.READ, ArticleAction.ARCHIVE, ArticleAction.DELETE ->
                save(action.changeOf(article))

            ArticleAction.REGENERATE -> regenerate(article.itemId)
            ArticleAction.OPEN -> if (article.webHost != null) send(ArticleActionEvent.Open(article.url))
            ArticleAction.SHARE -> if (article.webHost != null) share(article.title, article.url)
            ArticleAction.COPY_LINK -> if (article.webHost != null) copy(article.url)
        }
    }

    /** Runs [action] for the article of the open sheet. */
    fun choose(action: ArticleAction) {
        val article = state.value.article ?: return
        when (action) {
            ArticleAction.FAVOURITE, ArticleAction.READ, ArticleAction.ARCHIVE -> saveInSheet(action, article)
            ArticleAction.REGENERATE -> regenerate(article.itemId)
            ArticleAction.DELETE, ArticleAction.OPEN, ArticleAction.SHARE, ArticleAction.COPY_LINK -> {
                closeSheet()
                run(action, article)
            }
        }
    }

    /** Saves [change]; a failure is told, with a retry that saves the same change again. */
    fun save(change: ArticleChange) {
        scope.launch(dispatcher) {
            if (!saved(change)) failed(change)
        }
    }

    fun share(title: String, url: String) = send(ArticleActionEvent.Share(title, url))

    fun copy(url: String) = send(ArticleActionEvent.Copy(url))

    /** Reads the details of [itemId] again; only one run at a time for one article. */
    fun regenerate(itemId: String) {
        val before = state.getAndUpdate {
            it.copy(
                regenerating = it.regenerating + itemId,
                failure = if (it.article?.itemId == itemId) null else it.failure,
            )
        }
        if (itemId in before.regenerating) return

        scope.launch(dispatcher) {
            val answer = try {
                refreshDetails(itemId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Could not update the details of %s", itemId)
                DetailsRefresh.Failed
            }
            val error = when (answer) {
                is DetailsRefresh.Updated -> null
                DetailsRefresh.Missing -> ErrorMessage.ARTICLE_MISSING
                DetailsRefresh.NoLink -> ErrorMessage.ARTICLE_HAS_NO_LINK
                DetailsRefresh.Failed -> ErrorMessage.DETAILS_NOT_UPDATED
            }
            if (answer is DetailsRefresh.Updated) onDetails(itemId, answer)
            val inSheet = endInSheet(itemId, error?.text) { it.copy(regenerating = it.regenerating - itemId) }
            when {
                error == null -> emit(ArticleActionEvent.Say("Article details updated"))
                inSheet -> Unit
                error == ErrorMessage.DETAILS_NOT_UPDATED ->
                    emit(ArticleActionEvent.Failed(error) { regenerate(itemId) })
                else -> emit(ArticleActionEvent.Failed(error))
            }
        }
    }

    private fun saveInSheet(action: ArticleAction, article: ArticleItem) {
        val itemId = article.itemId
        val before = state.getAndUpdate { it.copy(saving = it.saving + itemId, failure = null) }
        if (itemId in before.saving) return

        val change = action.changeOf(article)
        val label = articleActions(article).first { it.action == action }.label
        scope.launch(dispatcher) {
            val failure = if (saved(change)) null else "$label was not saved on this phone. Choose it again to retry."
            val inSheet = endInSheet(itemId, failure) { it.copy(saving = it.saving - itemId) }
            if (failure != null && !inSheet) failed(change)
        }
    }

    /**
     * Ends the work of [itemId] with [end], and gives its answer to the sheet when the sheet shows
     * this article: no failure closes it, a failure stays in it. Returns whether the sheet showed it.
     */
    private fun endInSheet(itemId: String, failure: String?, end: (State) -> State): Boolean {
        val before = state.getAndUpdate { now ->
            val ended = end(now)
            when {
                now.article?.itemId != itemId -> ended
                failure == null -> ended.copy(article = null, failure = null)
                else -> ended.copy(failure = failure)
            }
        }
        return before.article?.itemId == itemId
    }

    /** Saves [change] and tells what it did; false when it was not saved. */
    private suspend fun saved(change: ArticleChange): Boolean {
        val itemId = change.itemId
        try {
            when (change) {
                is ArticleChange.Favourite -> repository.setFavorite(itemId, change.isFavorite)
                is ArticleChange.Read -> repository.setReadStatus(itemId, change.isRead)
                is ArticleChange.Archive -> repository.archive(itemId)
                is ArticleChange.Delete -> repository.delete(itemId)
                is ArticleChange.Restore -> repository.restore(itemId)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "%s failed", change::class.simpleName)
            return false
        }
        onSaved(change)
        when (change) {
            is ArticleChange.Archive -> emit(ArticleActionEvent.Say("Article archived"))
            is ArticleChange.Delete -> emit(ArticleActionEvent.Deleted { save(ArticleChange.Restore(itemId)) })
            else -> Unit
        }
        return true
    }

    private suspend fun failed(change: ArticleChange) =
        emit(ArticleActionEvent.Failed(ErrorMessage.CHANGE_FAILED) { save(change) })

    private fun send(event: ArticleActionEvent) {
        scope.launch { emit(event) }
    }

    private fun ArticleAction.changeOf(article: ArticleItem): ArticleChange = when (this) {
        ArticleAction.FAVOURITE -> ArticleChange.Favourite(article.itemId, !article.favorite)
        ArticleAction.READ -> ArticleChange.Read(article.itemId, !article.isRead)
        ArticleAction.ARCHIVE -> ArticleChange.Archive(article.itemId)
        else -> ArticleChange.Delete(article.itemId)
    }
}
