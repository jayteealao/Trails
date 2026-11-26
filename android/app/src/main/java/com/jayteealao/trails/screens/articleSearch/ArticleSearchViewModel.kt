package com.jayteealao.trails.screens.articleSearch

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleAction
import com.jayteealao.trails.screens.articleList.actions.ArticleActionEvent
import com.jayteealao.trails.screens.articleList.actions.ArticleActionRunner
import com.jayteealao.trails.screens.articleList.actions.ArticleChange
import com.jayteealao.trails.screens.articleList.actions.refreshArticleDetails
import com.jayteealao.trails.screens.components.ErrorMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import timber.log.Timber
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Provider

@HiltViewModel
class ArticleSearchViewModel @Inject constructor(
    private val pocketRepository: ArticleRepository,  //TODO: remove uses of pocket repository
    private val unfurlers: Provider<Unfurler>,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<ArticleSearchState, ArticleSearchEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleSearchEvent>()
    override val event: SharedFlow<ArticleSearchEvent> = _event.asSharedFlow()

    private val actions = ArticleActionRunner(
        repository = pocketRepository,
        scope = viewModelScope,
        dispatcher = ioDispatcher,
        refreshDetails = { refreshArticleDetails(pocketRepository, unfurlers.get(), it) },
        emit = { _event.emit(it.toSearchEvent()) },
        onSaved = ::showChange,
        onDetails = { itemId, details ->
            updateRow(itemId) { it.copy(title = details.title, url = details.url, image = details.image) }
        },
    )

    /** The newest search: its words, where it stands and what it found. */
    private data class Search(
        val query: String? = null,
        val running: Boolean = false,
        val failed: Boolean = false,
        val results: List<ArticleItem> = emptyList(),
        /** Deleted since the search; each keeps its place in [results], so Undo shows it there. */
        val hidden: Set<String> = emptySet(),
    )

    private val newestSearch = MutableStateFlow(Search())

    // The running search and the number of the newest one: a search that was replaced never
    // writes its results, its error or the searching flag, even if its database call ignores
    // cancellation.
    private var searchJob: Job? = null
    private val searchGeneration = AtomicLong()

    private val tagsFlow = pocketRepository.allTags()
        .catch { error ->
            Timber.e(error, "Could not read the tags")
            emit(emptyList())
        }
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), emptyList())

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(newestSearch, tagsFlow, actions.sheet) { search, tags, sheet ->
        ArticleSearchState(
            searchResults = search.results.filterNot { it.itemId in search.hidden },
            foundNothing = search.query != null && search.results.isEmpty(),
            isSearching = search.running,
            searchedQuery = search.query,
            searchFailed = search.failed,
            tags = tags,
            actionSheet = sheet,
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleSearchState()
    )

    override val state: StateFlow<ArticleSearchState> = _state

    // Actions
    /**
     * Runs [query], cancelling the search before it; only the newest search reaches the state. A
     * search without words clears the search.
     */
    fun search(query: String) {
        if (query.isBlank()) return clearSearch()
        searchJob?.cancel()
        val generation = searchGeneration.incrementAndGet()
        newestSearch.update { it.copy(query = query, running = true, failed = false, hidden = emptySet()) }
        searchJob = viewModelScope.launch(ioDispatcher) {
            try {
                val results = pocketRepository.searchLocal(query)
                ensureActive()
                updateIfNewest(generation) { it.copy(results = results, running = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "The search failed")
                updateIfNewest(generation) { it.copy(failed = true, running = false) }
            }
        }
    }

    /** Drops the running search and everything the last one found. */
    fun clearSearch() {
        searchJob?.cancel()
        searchGeneration.incrementAndGet()
        newestSearch.value = Search()
    }

    /** The results are read once, so a saved change is shown in them here. */
    private fun showChange(change: ArticleChange) {
        when (change) {
            is ArticleChange.Favourite -> updateRow(change.itemId) { it.copy(favorite = change.isFavorite) }
            is ArticleChange.Read -> updateRow(change.itemId) { it.copy(isRead = change.isRead) }
            is ArticleChange.Archive -> Unit
            is ArticleChange.Delete -> newestSearch.update { it.copy(hidden = it.hidden + change.itemId) }
            is ArticleChange.Restore -> newestSearch.update { it.copy(hidden = it.hidden - change.itemId) }
        }
    }

    private fun updateRow(itemId: String, change: (ArticleItem) -> ArticleItem) = newestSearch.update { search ->
        search.copy(results = search.results.map { if (it.itemId == itemId) change(it) else it })
    }

    private fun updateIfNewest(generation: Long, change: (Search) -> Search) {
        newestSearch.update { if (generation == searchGeneration.get()) change(it) else it }
    }

    /** Runs one change; a failure is told, with a retry that runs the same change again. */
    private fun change(name: String, block: suspend () -> Unit) {
        viewModelScope.launch(ioDispatcher) {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "%s failed", name)
                _event.emit(ArticleSearchEvent.ShowError(ErrorMessage.CHANGE_FAILED) { change(name, block) })
            }
        }
    }

    fun setFavorite(itemId: String, isFavorite: Boolean) =
        actions.save(ArticleChange.Favourite(itemId, isFavorite))

    fun setReadStatus(itemId: String, isRead: Boolean) = actions.save(ArticleChange.Read(itemId, isRead))

    fun archiveArticle(itemId: String) = actions.save(ArticleChange.Archive(itemId))

    fun deleteArticle(itemId: String) = actions.save(ArticleChange.Delete(itemId))

    fun regenerateArticleDetails(itemId: String) = actions.regenerate(itemId)

    /** Runs [action] of [article], which is the article as its row shows it. */
    fun runAction(action: ArticleAction, article: ArticleItem) = actions.run(action, article)

    fun openActions(article: ArticleItem) = actions.openSheet(article)

    fun chooseAction(action: ArticleAction) = actions.choose(action)

    fun closeActions() = actions.closeSheet()

    fun updateTag(itemId: String, tag: String, enabled: Boolean) = change("updateTag") {
        if (enabled) {
            pocketRepository.addTag(itemId, tag)
        } else {
            pocketRepository.removeTag(itemId, tag)
        }
    }

    fun shareArticle(title: String, url: String) {
        viewModelScope.launch {
            _event.emit(ArticleSearchEvent.ShareArticle(title, url))
        }
    }

    fun copyLink(url: String, label: String = "Article URL") {
        viewModelScope.launch {
            _event.emit(ArticleSearchEvent.CopyLink(url, label))
        }
    }

    private companion object {
        fun ArticleActionEvent.toSearchEvent(): ArticleSearchEvent = when (this) {
            is ArticleActionEvent.Say -> ArticleSearchEvent.ShowToast(message)
            is ArticleActionEvent.Failed -> ArticleSearchEvent.ShowError(message, retry)
            is ArticleActionEvent.Deleted -> ArticleSearchEvent.ArticleDeleted(undo)
            is ArticleActionEvent.Share -> ArticleSearchEvent.ShareArticle(title, url)
            is ArticleActionEvent.Copy -> ArticleSearchEvent.CopyLink(url)
            is ArticleActionEvent.Open -> ArticleSearchEvent.OpenInBrowser(url)
        }
    }
}
