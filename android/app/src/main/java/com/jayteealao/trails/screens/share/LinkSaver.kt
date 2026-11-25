package com.jayteealao.trails.screens.share

import com.jayteealao.trails.common.di.ApplicationScope
import com.jayteealao.trails.common.generateId
import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.articleList.actions.refreshArticleDetails
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.saket.unfurl.Unfurler
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

/** Saves links that other apps share. A save ends although the screen that started it has closed. */
interface LinkSaver {
    fun save(link: SharedLink): LinkSave
}

/** One save of one link. */
interface LinkSave {
    val state: StateFlow<LinkSaveState>

    /** Removes what this save added; a second call while it does so, or after, does nothing. */
    fun undo()
}

data class LinkSaveState(val phase: SavePhase, val title: String)

enum class SavePhase {
    SAVING,
    SAVED,

    /** The article was in the library before, so there is nothing to undo. */
    ALREADY_SAVED,
    NOT_SAVED,
    UNDOING,
    UNDONE,

    /** The undo failed; the article is still saved. */
    NOT_UNDONE,
}

@Singleton
class DefaultLinkSaver @Inject constructor(
    private val repository: ArticleRepository,
    private val unfurlers: Provider<Unfurler>,
    @ApplicationScope private val scope: CoroutineScope,
) : LinkSaver {

    override fun save(link: SharedLink): LinkSave = Save(link).also { save -> scope.launch { save.store() } }

    private inner class Save(private val link: SharedLink) : LinkSave {

        private val _state = MutableStateFlow(LinkSaveState(SavePhase.SAVING, link.title.ifBlank { link.address }))
        override val state: StateFlow<LinkSaveState> = _state.asStateFlow()

        private var itemId: String? = null
        private var details: Job? = null

        suspend fun store() {
            val now = System.currentTimeMillis()
            val saved = try {
                repository.saveNewArticle(
                    Article(
                        itemId = generateId(),
                        title = link.title,
                        givenTitle = link.title,
                        url = link.url,
                        givenUrl = link.url,
                        normalizedUrl = normalizeUrl(link.url),
                        timeAdded = now,
                        timeUpdated = now,
                    ),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Could not store a shared link")
                return setPhase(SavePhase.NOT_SAVED)
            }
            // Both are set before the phase says saved, because an undo reads them from then on.
            itemId = saved.itemId
            val reading = scope.launch(start = CoroutineStart.LAZY) { readDetails(saved.itemId) }
            details = reading
            setPhase(if (saved.alreadySaved) SavePhase.ALREADY_SAVED else SavePhase.SAVED)
            reading.start()
        }

        /** The article is stored, so nothing that fails here changes the phase. */
        private suspend fun readDetails(itemId: String) {
            attempt("show the stored title") { showStoredTitle(itemId) }
            attempt("read the page") { refreshArticleDetails(repository, unfurlers.get(), itemId) }
            attempt("show the stored title") { showStoredTitle(itemId) }
            attempt("back up the article") { repository.backupArticleNow(itemId).getOrThrow() }
            attempt("start the sync") { repository.syncToFirestore() }
        }

        private suspend fun showStoredTitle(itemId: String) {
            val article = repository.getArticleById(itemId) ?: return
            val title = article.title.ifBlank { article.givenTitle }
            if (title.isNotBlank()) _state.update { it.copy(title = title) }
        }

        override fun undo() {
            while (true) {
                val current = _state.value
                if (current.phase != SavePhase.SAVED && current.phase != SavePhase.NOT_UNDONE) return
                if (_state.compareAndSet(current, current.copy(phase = SavePhase.UNDOING))) break
            }
            // Not waited for: a page read can take its time to end.
            details?.cancel()
            val id = itemId ?: return
            scope.launch {
                if (attempt("remove the article") { repository.delete(id) }) {
                    // A backup that still runs can hold the sync that the removal starts by itself.
                    attempt("start the sync") { repository.syncToFirestore() }
                    setPhase(SavePhase.UNDONE)
                } else {
                    setPhase(SavePhase.NOT_UNDONE)
                }
            }
        }

        private fun setPhase(phase: SavePhase) = _state.update { it.copy(phase = phase) }
    }

    /**
     * Runs [block] and returns whether it worked. A cancelled coroutine stops here although the
     * block hid it, as reading a page does.
     */
    private suspend fun attempt(what: String, block: suspend () -> Unit): Boolean {
        val worked = try {
            block()
            true
        } catch (e: CancellationException) {
            // A backup can give back a cancellation of its own; only the one of this coroutine stops it.
            currentCoroutineContext().ensureActive()
            Timber.w(e, "Could not %s", what)
            false
        } catch (e: Exception) {
            Timber.w(e, "Could not %s", what)
            false
        }
        currentCoroutineContext().ensureActive()
        return worked
    }
}
