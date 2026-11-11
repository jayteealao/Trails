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
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.archive.TextSourceRank
import com.jayteealao.trails.data.local.database.Article
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
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
    val archiveSyncing: Boolean,
    val textSource: String,
    val selectedArchiveContent: String?,
)

private data class NoticeGroup(
    val online: Boolean,
    val articleStatus: String?,
    val textDownloadFailed: Boolean,
    val localText: LocalText,
    val selectedArchiveLoadFailed: Boolean,
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
    private val _archiveSyncing = MutableStateFlow(false)
    private val _textSource = MutableStateFlow("")
    private val _selectedArchiveContent = MutableStateFlow<String?>(null)
    private val _articleStatus = MutableStateFlow<String?>(null)
    private val _textDownloadFailed = MutableStateFlow(false)
    private val _localText = MutableStateFlow(LocalText.NONE)
    private val _selectedArchiveLoadFailed = MutableStateFlow(false)

    private var archiveObserverJob: Job? = null
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
        _remoteArchives, _localArchives, _archiveSyncing, _textSource, _selectedArchiveContent
    ) { remote, local, syncing, textSrc, selectedContent ->
        ArchiveGroup(remote, local, syncing, textSrc, selectedContent)
    }

    private val noticeGroupFlow = combine(
        networkMonitor.isOnline, _articleStatus, _textDownloadFailed, _localText, _selectedArchiveLoadFailed
    ) { online, status, downloadFailed, localText, loadFailed ->
        NoticeGroup(online, status, downloadFailed, localText, loadFailed)
    }

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(articleGroupFlow, archiveGroupFlow, noticeGroupFlow) { ag, arc, ng ->
        ArticleDetailState(
            article = ag.article,
            selectedTabIndex = ag.selectedTabIndex,
            useFreedium = ag.useFreedium,
            isLoading = ag.isLoading,
            remoteArchives = arc.remoteArchives,
            localArchives = arc.localArchives,
            archiveSyncing = arc.archiveSyncing,
            textSource = arc.textSource,
            selectedArchiveContent = arc.selectedArchiveContent,
            online = ng.online,
            articleStatus = ng.articleStatus,
            selectedArchiveLoadFailed = ng.selectedArchiveLoadFailed,
            readerBody = readerBodyFor(readerSignals(ag, arc, ng)),
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
                    _event.emit(ArticleDetailEvent.ShowError(e))
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
            archiveObserverJob?.cancel()
        }
        currentArticleId = itemId

        viewModelScope.launch(ioDispatcher) {
            _isLoading.value = true
            try {
                // Rank the local text archives first, so the one read below gets the best text.
                _localText.value = offerBestText(itemId, localArchiveDao.getArchivesForArticle(itemId))
                publishArticle(itemId)

                // Start archive observation
                loadArchives(itemId)
            } catch (e: Exception) {
                Timber.e(e, "getArticle($itemId) — failed")
                _event.emit(ArticleDetailEvent.ShowError(e))
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun setSelectedTab(index: Int) {
        _selectedTabIndex.value = index
        _selectedArchiveContent.value = null
        _selectedArchiveLoadFailed.value = false

        // If selecting an archive tab (index >= 2), load its content
        val archiveTabs = getAvailableArchiveTypes()
        val archiveIndex = index - 2
        if (archiveIndex >= 0 && archiveIndex < archiveTabs.size) {
            val archiveType = archiveTabs[archiveIndex]
            loadArchiveContent(archiveType)
        }
    }

    fun markAsRead(itemId: String) {
        viewModelScope.launch(ioDispatcher) {
            try {
                articleRepository.setReadStatus(itemId, true)
                _event.emit(ArticleDetailEvent.ArticleMarkedAsRead(itemId))
            } catch (e: Exception) {
                _event.emit(ArticleDetailEvent.ShowError(e))
            }
        }
    }

    private fun loadArchives(itemId: String) {
        Timber.d("loadArchives($itemId) — starting")
        archiveObserverJob?.cancel()
        archiveObserverJob = viewModelScope.launch(ioDispatcher) {
            // Show local archives immediately if any exist
            val existingArchives = localArchiveDao.getArchivesForArticle(itemId)
            if (existingArchives.isNotEmpty()) {
                Timber.d("loadArchives($itemId) — ${existingArchives.size} local archives, showing immediately")
                keepSelectionOnItsArchive(existingArchives)
                _localArchives.value = existingArchives
            }

            // Syncing while a text archive downloads; a large archive never holds the Reader.
            launch {
                archiveService.observeDownloads(itemId).collect { states ->
                    _archiveSyncing.value = states.any { (key, state) ->
                        state == ArchiveDownload.DOWNLOADING && ArchiveType.fromArchiveKey(key)?.providesText == true
                    }
                    val textStates = states.filterKeys { ArchiveType.fromArchiveKey(it)?.providesText == true }.values
                    _textDownloadFailed.value =
                        ArchiveDownload.FAILED in textStates && ArchiveDownload.DOWNLOADING !in textStates
                }
            }

            // The status of the shared article tells a failed archive from one still on its way.
            launch {
                archiveService.observeArticleStatus(itemId).collect { _articleStatus.value = it }
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
                    _localText.value = offerBestText(itemId, archives)
                    if (_article.value?.text.isNullOrBlank()) {
                        publishArticle(itemId)
                    }
                    keepSelectionOnItsArchive(archives)
                    _localArchives.value = archives
                }
            }

            launch {
                Timber.d("loadArchives($itemId) — remote observer started")
                archiveService.observeRemoteArchives(itemId).collect { remoteMap ->
                    Timber.d("loadArchives($itemId) — remote emit: ${remoteMap.size} archives")
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
     * [TextSourceRank]. A blank or unreadable archive gives way to the next one down. Returns
     * what the read found; the caller puts it in the notice state.
     */
    private suspend fun offerBestText(itemId: String, archives: List<LocalArchive>): LocalText {
        val keys = archives.map { it.archiveKey }
        val ranked = TextSourceRank.ORDER.filter { it in keys }
        var sawBlank = false
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
            articleRepository.offerArticleText(itemId, text, key)
            return LocalText.READABLE
        }
        return when {
            ranked.isEmpty() -> LocalText.NONE
            sawBlank -> LocalText.BLANK
            else -> LocalText.UNREADABLE
        }
    }

    /** What the Reader body is decided from; see [readerBodyFor]. */
    private fun readerSignals(ag: ArticleGroup, arc: ArchiveGroup, ng: NoticeGroup): ReaderSignals {
        val localKeys = arc.localArchives.map { it.archiveKey }.toSet()
        fun isText(key: String) = ArchiveType.fromArchiveKey(key)?.providesText == true
        return ReaderSignals(
            hasText = !ag.article?.text.isNullOrBlank(),
            loaded = !ag.isLoading && ag.article != null,
            online = ng.online,
            textDownloading = arc.archiveSyncing,
            textDownloadFailed = ng.textDownloadFailed,
            remoteTextPending = arc.remoteArchives.keys.any { isText(it) && it !in localKeys },
            localTextArchive = localKeys.any(::isText),
            localTextBlank = ng.localText == LocalText.BLANK,
            localTextUnreadable = ng.localText == LocalText.UNREADABLE,
            articleStatus = ng.articleStatus,
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

    fun getAvailableArchiveTypes(): List<ArchiveType> = archiveTypesOf(_localArchives.value)

    private fun archiveTypesOf(archives: List<LocalArchive>): List<ArchiveType> =
        detailTabsFor(archives.map { it.archiveKey }).mapNotNull { it.archiveType }

    /**
     * Tabs follow a fixed order, so an archive that arrives can take a place before the selected
     * one. Moves the selected archive tab to its archive's new place, or to the Reader tab when
     * its archive is gone. The Reader and Web tabs never move.
     */
    private fun keepSelectionOnItsArchive(newArchives: List<LocalArchive>) {
        val index = _selectedTabIndex.value
        if (index < FIRST_ARCHIVE_TAB_INDEX) return
        val selected = getAvailableArchiveTypes().getOrNull(index - FIRST_ARCHIVE_TAB_INDEX) ?: return
        val newPlace = archiveTypesOf(newArchives).indexOf(selected)
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
