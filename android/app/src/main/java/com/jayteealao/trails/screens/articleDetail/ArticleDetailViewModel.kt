package com.jayteealao.trails.screens.articleDetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.NetworkMonitor
import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.archive.ArchiveDownload
import com.jayteealao.trails.data.archive.ArchiveRetryClient
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.archive.RetryFailure
import com.jayteealao.trails.data.archive.TextSourceRank
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.settings.SettingsPreferenceKeys
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

// Internal data classes for grouping flow state
private data class ArticleGroup(
    val article: Article?,
    val selectedTabIndex: Int,
    val useFreedium: Boolean,
    val isLoading: Boolean,
)

private data class ArchiveGroup(
    val remoteArchives: Map<String, ArchiveStatus>,
    val localArchives: List<LocalArchive>,
    val textDownloading: Boolean,
    val textSource: String,
    val selectedArchiveContent: String?,
)

private data class NoticeGroup(
    val online: Boolean,
    val articleStatus: String?,
    val textDownloadFailed: Boolean,
    val localText: LocalText,
    val selectedArchiveLoadFailed: Boolean,
    val retries: Map<String, ArticleRetry>,
) {
    fun retryOf(itemId: String?): ArchiveRetryState = retries[itemId]?.retry ?: ArchiveRetryState.Idle
}

/** The retry of one article beside its last status, so one update reads and moves both. */
private data class ArticleRetry(
    val retry: ArchiveRetryState = ArchiveRetryState.Idle,
    val status: String? = null,
)

/** What the last read of the ranked local text archives found. */
private enum class LocalText { NONE, READABLE, BLANK, UNREADABLE }

@HiltViewModel
class ArticleDetailViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val sharedPreferencesManager: SharedPreferencesManager,
    private val archiveService: ArchiveService,
    private val localArchiveDao: LocalArchiveDao,
    private val urlModifier: UrlModifier,
    private val networkMonitor: NetworkMonitor,
    private val archiveRetryClient: ArchiveRetryClient,
    @Dispatcher(TrailsDispatchers.IO) private val ioDispatcher: CoroutineDispatcher
): ViewModel(), Store<ArticleDetailState, ArticleDetailEvent> {

    // Tartlet Store implementation - Event handling
    private val _event = MutableSharedFlow<ArticleDetailEvent>()
    override val event: SharedFlow<ArticleDetailEvent> = _event.asSharedFlow()

    // Internal mutable states
    private val _article = MutableStateFlow<Article?>(null)
    private val _selectedTabIndex = MutableStateFlow(1)
    private val _isLoading = MutableStateFlow(false)
    private val _remoteArchives = MutableStateFlow<Map<String, ArchiveStatus>>(emptyMap())
    private val _localArchives = MutableStateFlow<List<LocalArchive>>(emptyList())
    private val _textDownloading = MutableStateFlow(false)
    private val _textSource = MutableStateFlow("")
    private val _selectedArchiveContent = MutableStateFlow<String?>(null)
    private val _articleStatus = MutableStateFlow<String?>(null)
    private val _textDownloadFailed = MutableStateFlow(false)
    private val _localText = MutableStateFlow(LocalText.NONE)
    private val _selectedArchiveLoadFailed = MutableStateFlow(false)
    private val _downloadStates = MutableStateFlow<Map<String, ArchiveDownload>>(emptyMap())

    /** Kept per article, so a switch to another one and back does not free a pending request. */
    private val _retries = MutableStateFlow<Map<String, ArticleRetry>>(emptyMap())

    private var archiveObserverJob: Job? = null

    /** The text archives (key and download time) the last [offerBestText] read; null before one. */
    private var lastReadTextArchives: Set<Pair<String, Long>>? = null
    private var currentArticleId: String? = null

    private val useFreediumFlow = sharedPreferencesManager.preferenceChangesFlow()
        .filter { it == SettingsPreferenceKeys.USE_FREEDIUM }
        .map {
            Timber.d("Preference changed: $it")
            sharedPreferencesManager.getBoolean(it!!)
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM)
        )

    // Intermediate flow groups for typed combine()
    private val articleGroupFlow = combine(
        _article, _selectedTabIndex, useFreediumFlow, _isLoading
    ) { article, tab, useFreedium, loading ->
        ArticleGroup(article, tab, useFreedium, loading)
    }

    private val archiveGroupFlow = combine(
        _remoteArchives, _localArchives, _textDownloading, _textSource, _selectedArchiveContent
    ) { remote, local, syncing, textSrc, selectedContent ->
        ArchiveGroup(remote, local, syncing, textSrc, selectedContent)
    }

    private val noticeGroupFlow = combine(
        networkMonitor.isOnline,
        combine(_articleStatus, _retries, ::Pair),
        _textDownloadFailed,
        _localText,
        _selectedArchiveLoadFailed,
    ) { online, (status, retries), downloadFailed, localText, loadFailed ->
        NoticeGroup(online, status, downloadFailed, localText, loadFailed, retries)
    }

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(articleGroupFlow, archiveGroupFlow, noticeGroupFlow, _downloadStates) { ag, arc, ng, downloads ->
        val localKeys = arc.localArchives.map { it.archiveKey }.toSet()
        val tabKeys = tabArchiveKeys(localKeys, arc.remoteArchives)
        val pending = tabKeys.filterNot { it in localKeys }.toSet()
        ArticleDetailState(
            tabArchiveKeys = tabKeys,
            pendingArchiveKeys = pending,
            failedArchiveKeys = pending.filter { downloads[it] == ArchiveDownload.FAILED }.toSet(),
            article = ag.article,
            selectedTabIndex = ag.selectedTabIndex,
            useFreedium = ag.useFreedium,
            isLoading = ag.isLoading,
            remoteArchives = arc.remoteArchives,
            localArchives = arc.localArchives,
            textDownloading = arc.textDownloading,
            textSource = arc.textSource,
            selectedArchiveContent = arc.selectedArchiveContent,
            online = ng.online,
            articleStatus = ng.articleStatus,
            selectedArchiveLoadFailed = ng.selectedArchiveLoadFailed,
            readerBody = readerBodyFor(readerSignals(ag, arc, ng)),
            archiveRow = archiveRowFor(
                hasText = !ag.article?.text.isNullOrBlank(),
                status = ng.articleStatus,
                retry = ng.retryOf(ag.article?.itemId),
            ),
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleDetailState(
            useFreedium = sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM)
        )
    )

    override val state: StateFlow<ArticleDetailState> = _state

    // Actions
    fun getArticle(itemId: String) {
        updateRetry(itemId) { it.copy(retry = it.retry.onReopen()) }

        // The same article opens again: read the stored text once more, so a better source
        // that arrived while it was open shows now. Keep a running observer.
        if (currentArticleId == itemId && _article.value?.itemId == itemId) {
            viewModelScope.launch(ioDispatcher) {
                try {
                    publishArticle(itemId)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.e(e, "getArticle($itemId) — reopen read failed")
                    tellOpenFailed(itemId)
                }
            }
            // Re-attach observer only if the previous one completed or was cancelled
            if (archiveObserverJob?.isActive != true) {
                loadArchives(itemId)
            }
            return
        }

        // Reset stale state when switching articles
        if (currentArticleId != null && currentArticleId != itemId) {
            _article.value = null
            _localArchives.value = emptyList()
            _remoteArchives.value = emptyMap()
            _selectedArchiveContent.value = null
            _selectedTabIndex.value = 1
            _textSource.value = ""
            _articleStatus.value = null
            _textDownloadFailed.value = false
            _localText.value = LocalText.NONE
            _selectedArchiveLoadFailed.value = false
            _downloadStates.value = emptyMap()
            archiveObserverJob?.cancel()
        }
        currentArticleId = itemId

        viewModelScope.launch(ioDispatcher) {
            _isLoading.value = true
            try {
                // Rank the local text archives first, so the one read below gets the best text.
                val archives = localArchiveDao.getArchivesForArticle(itemId)
                _localText.value = offerBestText(itemId, archives)
                lastReadTextArchives = textArchivesOf(archives)
                publishArticle(itemId)

                // Start archive observation
                loadArchives(itemId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "getArticle($itemId) — failed")
                tellOpenFailed(itemId)
            } finally {
                _isLoading.value = false
            }
        }
    }

    /** Tells that [itemId] did not open, unless another article was opened since. */
    private suspend fun tellOpenFailed(itemId: String) {
        if (currentArticleId != itemId) return
        _event.emit(
            ArticleDetailEvent.ShowError(ErrorMessage.OPEN_FAILED) {
                if (currentArticleId == itemId) getArticle(itemId)
            }
        )
    }

    fun setSelectedTab(index: Int) {
        _selectedTabIndex.value = index
        _selectedArchiveContent.value = null
        _selectedArchiveLoadFailed.value = false

        // An archive tab loads its file; a tab whose archive is still on its way loads it when
        // the download lands (see the local archive collector).
        val archiveType = getAvailableArchiveTypes().getOrNull(index - FIRST_ARCHIVE_TAB_INDEX) ?: return
        if (_localArchives.value.any { it.archiveKey == archiveType.archiveKey }) {
            loadArchiveContent(archiveType)
        }
    }

    fun markAsRead(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.setReadStatus(itemId, true)
                _event.emit(ArticleDetailEvent.ArticleMarkedAsRead(itemId))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "markAsRead($itemId) — failed")
                _event.emit(ArticleDetailEvent.ShowError(ErrorMessage.MARK_READ_FAILED) { markAsRead(itemId) })
            }
        }
    }

    /**
     * Asks the server to run the failed archive of [itemId] again. A tap that is not allowed now
     * (a request is pending, or the status cannot be retried) does nothing.
     */
    fun retryArchive(itemId: String) {
        val online = state.value.online
        val before = _retries.getAndUpdate { it.changed(itemId) { entry -> entry.copy(retry = entry.tapped(online)) } }
        // Only the tap that moved the state to Sending sends the request.
        val entry = before[itemId] ?: ArticleRetry()
        if (entry.retry is ArchiveRetryState.Sending || entry.tapped(online) !is ArchiveRetryState.Sending) return
        viewModelScope.launch(ioDispatcher) {
            val answer = archiveRetryClient.retry(itemId)
            updateRetry(itemId) { it.copy(retry = it.retry.onAnswer(answer, it.status)) }
        }
    }

    private fun ArticleRetry.tapped(online: Boolean): ArchiveRetryState {
        val tapped = retry.onTap(status)
        val sends = tapped is ArchiveRetryState.Sending && retry !is ArchiveRetryState.Sending
        return if (sends && !online) ArchiveRetryState.NotSent(RetryFailure.OFFLINE) else tapped
    }

    private fun updateRetry(itemId: String, change: (ArticleRetry) -> ArticleRetry) {
        _retries.update { it.changed(itemId, change) }
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

    private fun loadArchives(itemId: String) {
        Timber.d("loadArchives($itemId) — starting")
        archiveObserverJob?.cancel()
        archiveObserverJob = viewModelScope.launch(ioDispatcher) {
            // Show local archives immediately if any exist
            val existingArchives = localArchiveDao.getArchivesForArticle(itemId)
            if (existingArchives.isNotEmpty()) {
                Timber.d("loadArchives($itemId) — ${existingArchives.size} local archives, showing immediately")
                keepSelectionOnItsArchive(tabArchiveKeys(existingArchives.map { it.archiveKey }, _remoteArchives.value))
                _localArchives.value = existingArchives
            }

            // Syncing while a text archive downloads; a large archive never holds the Reader.
            launch {
                archiveService.observeDownloads(itemId).collect { states ->
                    _downloadStates.value = states
                    _textDownloading.value = states.any { (key, state) ->
                        state == ArchiveDownload.DOWNLOADING && ArchiveType.fromArchiveKey(key)?.providesText == true
                    }
                    val textStates = states.filterKeys { ArchiveType.fromArchiveKey(it)?.providesText == true }.values
                    _textDownloadFailed.value =
                        ArchiveDownload.FAILED in textStates && ArchiveDownload.DOWNLOADING !in textStates
                }
            }

            // The status of the shared article tells a failed archive from one still on its way.
            launch {
                archiveService.observeArticleStatus(itemId).collect { status ->
                    updateRetry(itemId) { ArticleRetry(it.retry.onStatus(status), status) }
                    _articleStatus.value = status
                }
            }

            // Back online: download what failed or waited while offline.
            launch {
                var wasOnline: Boolean? = null
                networkMonitor.isOnline.collect { online ->
                    val remote = _remoteArchives.value
                    if (online && wasOnline == false && remote.isNotEmpty()) {
                        try {
                            archiveService.syncArchives(itemId, remote)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Timber.e(e, "Failed to sync archives for $itemId after reconnecting")
                        }
                    }
                    if (online) updateRetry(itemId) { it.copy(retry = it.retry.onOnline()) }
                    wasOnline = online
                }
            }

            // Always observe for new/updated archives (syncArchives skips an archive on disk or downloading)
            launch {
                localArchiveDao.observeArchives(itemId).collect { archives ->
                    Timber.d("loadArchives($itemId) — local emit: ${archives.size} archives [${archives.map { it.archiveKey }}]")
                    // A better source changes the stored text; the text on screen stays
                    // until the next open, unless there was none. The text is read before the
                    // new archives show, so the Reader never shows a notice for text it has.
                    // Only a change of the text archives is read again; a heavy archive row
                    // that lands leaves the text as it was.
                    val textArchives = textArchivesOf(archives)
                    if (textArchives != lastReadTextArchives) {
                        _localText.value = offerBestText(itemId, archives)
                        lastReadTextArchives = textArchives
                    }
                    if (_article.value?.text.isNullOrBlank()) {
                        publishArticle(itemId)
                    }
                    val selected = selectedArchiveType()
                    val wasLocal = selected != null && _localArchives.value.any { it.archiveKey == selected.archiveKey }
                    keepSelectionOnItsArchive(tabArchiveKeys(archives.map { it.archiveKey }, _remoteArchives.value))
                    _localArchives.value = archives
                    // The selected tab was waiting for its archive, and the download landed.
                    if (selected != null && !wasLocal && selectedArchiveType() == selected &&
                        archives.any { it.archiveKey == selected.archiveKey }
                    ) {
                        loadArchiveContent(selected)
                    }
                }
            }

            launch {
                Timber.d("loadArchives($itemId) — remote observer started")
                archiveService.observeRemoteArchives(itemId).collect { remoteMap ->
                    Timber.d("loadArchives($itemId) — remote emit: ${remoteMap.size} archives")
                    keepSelectionOnItsArchive(tabArchiveKeys(_localArchives.value.map { it.archiveKey }, remoteMap))
                    _remoteArchives.value = remoteMap

                    if (remoteMap.isNotEmpty()) {
                        try {
                            archiveService.syncArchives(itemId, remoteMap)
                            Timber.d("loadArchives($itemId) — downloads started")
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Timber.e(e, "Failed to sync archives for $itemId")
                        }
                        try {
                            archiveService.applyWargMetadata(itemId)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Timber.e(e, "Failed to apply Warg metadata for $itemId")
                        }
                    }
                }
            }
        }
    }

    /** Reads the article from Room and puts it, with its text, on screen. */
    private suspend fun publishArticle(itemId: String) {
        var article = articleRepository.getArticleById(itemId)
        Timber.d("publishArticle($itemId) — found=${article != null}, textSource=${article?.textSource}")
        if (useFreediumFlow.value && article != null) {
            article = article.copy(url = urlModifier.modifyUrl(article.url ?: article.givenUrl!!))
        }
        _article.value = article
        _textSource.value = article?.textSource ?: ""
    }

    /**
     * Offers the best-ranked text archive of [archives] that has words as the stored text, per
     * [TextSourceRank]. A blank or unreadable archive gives way to the next one down, and so
     * does a run-together one while a text with paragraphs is below it. Returns what the read
     * found; the caller puts it in the notice state.
     */
    private suspend fun offerBestText(itemId: String, archives: List<LocalArchive>): LocalText {
        val keys = archives.map { it.archiveKey }
        val ranked = TextSourceRank.ORDER.filter { it in keys }
        var sawBlank = false
        var runTogether: Pair<String, String>? = null
        for (key in ranked) {
            val type = ArchiveType.fromArchiveKey(key) ?: continue
            val text = archiveService.readArchiveText(itemId, type)
            if (text == null) {
                Timber.w("offerBestText($itemId) — readArchiveText returned null for $key")
                continue
            }
            if (text.isBlank()) {
                sawBlank = true
                continue
            }
            if (TextSourceRank.isRunTogether(text)) {
                if (runTogether == null) runTogether = key to text
                continue
            }
            articleRepository.offerArticleText(itemId, text, key)
            return LocalText.READABLE
        }
        runTogether?.let { (key, text) ->
            articleRepository.offerArticleText(itemId, text, key)
            return LocalText.READABLE
        }
        return when {
            ranked.isEmpty() -> LocalText.NONE
            sawBlank -> LocalText.BLANK
            else -> LocalText.UNREADABLE
        }
    }

    private fun textArchivesOf(archives: List<LocalArchive>): Set<Pair<String, Long>> =
        archives.filter { TextSourceRank.rankOf(it.archiveKey) != null }
            .map { it.archiveKey to it.downloadedAt }
            .toSet()

    /** What the Reader body is decided from; see [readerBodyFor]. */
    private fun readerSignals(ag: ArticleGroup, arc: ArchiveGroup, ng: NoticeGroup): ReaderSignals {
        val localKeys = arc.localArchives.map { it.archiveKey }.toSet()
        fun isText(key: String) = ArchiveType.fromArchiveKey(key)?.providesText == true
        return ReaderSignals(
            hasText = !ag.article?.text.isNullOrBlank(),
            loaded = !ag.isLoading && ag.article != null,
            online = ng.online,
            textDownloading = arc.textDownloading,
            textDownloadFailed = ng.textDownloadFailed,
            remoteTextPending = arc.remoteArchives.keys.any { isText(it) && it !in localKeys },
            localTextArchive = localKeys.any(::isText),
            localTextBlank = ng.localText == LocalText.BLANK,
            localTextUnreadable = ng.localText == LocalText.UNREADABLE,
            articleStatus = ng.articleStatus,
            savedLongAgo = savedLongAgo(ag.article?.timeAdded ?: 0L, System.currentTimeMillis()),
            retry = ng.retryOf(ag.article?.itemId),
        )
    }

    private fun loadArchiveContent(type: ArchiveType) {
        val itemId = _article.value?.itemId ?: return
        Timber.d("loadArchiveContent($itemId, ${type.archiveKey}) — reading")
        viewModelScope.launch(ioDispatcher) {
            val content = archiveService.readArchiveText(itemId, type)
            Timber.d("loadArchiveContent($itemId, ${type.archiveKey}) — got ${content?.length ?: 0} chars")
            _selectedArchiveContent.value = content
            _selectedArchiveLoadFailed.value = content == null

            // A picked text tab goes through the same rank; the Reader text stays unless it was empty.
            if (type.providesText && content != null) {
                articleRepository.offerArticleText(itemId, content, type.archiveKey)
                if (_article.value?.text.isNullOrBlank()) {
                    publishArticle(itemId)
                }
            }
        }
    }

    /** The archive types that have a tab, in tab order: on the phone, or on their way to it. */
    fun getAvailableArchiveTypes(): List<ArchiveType> =
        archiveTypesOf(tabArchiveKeys(_localArchives.value.map { it.archiveKey }, _remoteArchives.value))

    private fun archiveTypesOf(tabKeys: List<String>): List<ArchiveType> =
        detailTabsFor(tabKeys).mapNotNull { it.archiveType }

    private fun selectedArchiveType(): ArchiveType? =
        getAvailableArchiveTypes().getOrNull(_selectedTabIndex.value - FIRST_ARCHIVE_TAB_INDEX)

    /**
     * Tabs follow a fixed order, so an archive that arrives can take a place before the selected
     * one. Moves the selected archive tab to its archive's new place, or to the Reader tab when
     * its archive is gone. The Reader and Web tabs never move.
     */
    private fun keepSelectionOnItsArchive(newTabKeys: List<String>) {
        val selected = selectedArchiveType() ?: return
        val newPlace = archiveTypesOf(newTabKeys).indexOf(selected)
        if (newPlace >= 0) {
            _selectedTabIndex.value = FIRST_ARCHIVE_TAB_INDEX + newPlace
        } else {
            _selectedTabIndex.value = READER_TAB_INDEX
            _selectedArchiveContent.value = null
        }
    }

    override fun onCleared() {
        super.onCleared()
        archiveObserverJob?.cancel()
    }
}
