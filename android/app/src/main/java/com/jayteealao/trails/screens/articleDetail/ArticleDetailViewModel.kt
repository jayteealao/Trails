package com.jayteealao.trails.screens.articleDetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.common.di.dispatchers.Dispatcher
import com.jayteealao.trails.common.di.dispatchers.TrailsDispatchers
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.local.database.Article
import dagger.hilt.android.lifecycle.HiltViewModel
import io.yumemi.tartlet.Store
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class ArticleDetailViewModel @Inject constructor(
    private val articleRepository: ArticleRepository,
    private val sharedPreferencesManager: SharedPreferencesManager,
    private val archiveService: ArchiveService,
    private val localArchiveDao: LocalArchiveDao,
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

    private var archiveObserverJob: Job? = null
    private var currentArticleId: String? = null

    private val useFreediumFlow = sharedPreferencesManager.preferenceChangesFlow()
        .filter { it == "USE_FREEDIUM" }
        .map {
            Timber.d("Preference changed: $it")
            sharedPreferencesManager.getBoolean(it!!)
        }.stateIn(
            scope = viewModelScope,
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = sharedPreferencesManager.getBoolean("USE_FREEDIUM")
        )

    // Tartlet Store implementation - Consolidated state
    private val _state = combine(
        _article,
        _selectedTabIndex,
        useFreediumFlow,
        _isLoading,
        _remoteArchives,
        _localArchives,
        _archiveSyncing,
        _textSource,
        _selectedArchiveContent,
    ) { values ->
        @Suppress("UNCHECKED_CAST")
        ArticleDetailState(
            article = values[0] as Article?,
            selectedTabIndex = values[1] as Int,
            useFreedium = values[2] as Boolean,
            isLoading = values[3] as Boolean,
            remoteArchives = values[4] as Map<String, ArchiveStatus>,
            localArchives = values[5] as List<LocalArchive>,
            archiveSyncing = values[6] as Boolean,
            textSource = values[7] as String,
            selectedArchiveContent = values[8] as String?,
        )
    }.stateIn(
        scope = viewModelScope,
        started = kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000),
        initialValue = ArticleDetailState(
            useFreedium = sharedPreferencesManager.getBoolean("USE_FREEDIUM")
        )
    )

    override val state: StateFlow<ArticleDetailState> = _state

    // Actions
    fun getArticle(itemId: String) {
        // Skip if already loaded and observer is still running
        if (currentArticleId == itemId && _article.value?.itemId == itemId) {
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
            archiveObserverJob?.cancel()
        }
        currentArticleId = itemId

        viewModelScope.launch(ioDispatcher) {
            _isLoading.value = true
            Timber.d("getArticle($itemId) — fetching from Room")
            try {
                val modifier = UrlModifier()
                var articleFetched = articleRepository.getArticleById(itemId)
                Timber.d("getArticle($itemId) — found=${articleFetched != null}, hasText=${articleFetched?.text?.take(30)}, textSource=${articleFetched?.textSource}")
                if (useFreediumFlow.value && articleFetched != null) {
                    articleFetched = articleFetched.copy(
                        url = modifier.modifyUrl(articleFetched.url ?: articleFetched.givenUrl!!)
                    )
                }
                _article.value = articleFetched
                _textSource.value = articleFetched?.textSource ?: ""

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
                _localArchives.value = existingArchives
                autoPopulateText(itemId, existingArchives)
            }

            // Always observe for new/updated archives (syncArchives deduplicates)
            launch {
                localArchiveDao.observeArchives(itemId).collect { archives ->
                    Timber.d("loadArchives($itemId) — local emit: ${archives.size} archives [${archives.map { it.archiveKey }}]")
                    _localArchives.value = archives

                    val article = _article.value
                    if (article != null && article.text.isNullOrBlank()) {
                        autoPopulateText(itemId, archives)
                    }
                }
            }

            launch {
                Timber.d("loadArchives($itemId) — remote observer started")
                archiveService.observeRemoteArchives(itemId).collect { remoteMap ->
                    Timber.d("loadArchives($itemId) — remote emit: ${remoteMap.size} archives")
                    _remoteArchives.value = remoteMap

                    if (remoteMap.isNotEmpty()) {
                        _archiveSyncing.value = true
                        try {
                            archiveService.syncArchives(itemId, remoteMap)
                            Timber.d("loadArchives($itemId) — syncArchives completed")
                        } catch (e: Exception) {
                            Timber.e(e, "Failed to sync archives for $itemId")
                        } finally {
                            _archiveSyncing.value = false
                        }
                    }
                }
            }
        }
    }

    private suspend fun autoPopulateText(itemId: String, archives: List<LocalArchive>) {
        // Prefer readability over markdown
        val textArchive = archives.firstOrNull { it.archiveKey == "readability" }
            ?: archives.firstOrNull { it.archiveKey == "markdown" }
        if (textArchive == null) {
            Timber.d("autoPopulateText($itemId) — no text archive available in [${archives.map { it.archiveKey }}]")
            return
        }

        val type = ArchiveType.fromArchiveKey(textArchive.archiveKey) ?: return
        Timber.d("autoPopulateText($itemId) — reading ${type.archiveKey} from local file")
        val text = archiveService.readArchiveText(itemId, type)
        if (text == null) {
            Timber.w("autoPopulateText($itemId) — readArchiveText returned null for ${type.archiveKey}")
            return
        }

        Timber.d("autoPopulateText($itemId) — got ${text.length} chars from ${type.archiveKey}, saving to Room")
        articleRepository.updateArticleText(itemId, text, type.archiveKey)
        _textSource.value = type.archiveKey

        // Refresh article from DB
        val updated = articleRepository.getArticleById(itemId)
        if (updated != null) {
            _article.value = if (useFreediumFlow.value) {
                val modifier = UrlModifier()
                updated.copy(url = modifier.modifyUrl(updated.url ?: updated.givenUrl!!))
            } else {
                updated
            }
            Timber.d("autoPopulateText($itemId) — article refreshed, text length=${updated.text?.length}")
        }
    }

    private fun loadArchiveContent(type: ArchiveType) {
        val itemId = _article.value?.itemId ?: return
        Timber.d("loadArchiveContent($itemId, ${type.archiveKey}) — reading")
        viewModelScope.launch(ioDispatcher) {
            val content = archiveService.readArchiveText(itemId, type)
            Timber.d("loadArchiveContent($itemId, ${type.archiveKey}) — got ${content?.length ?: 0} chars")
            _selectedArchiveContent.value = content

            // If this is a text-providing archive, also update article.text
            if (type.providesText && content != null && type.archiveKey != _textSource.value) {
                Timber.d("loadArchiveContent($itemId) — switching text source to ${type.archiveKey}")
                articleRepository.updateArticleText(itemId, content, type.archiveKey)
                _textSource.value = type.archiveKey
                val updated = articleRepository.getArticleById(itemId)
                if (updated != null) {
                    _article.value = if (useFreediumFlow.value) {
                        val modifier = UrlModifier()
                        updated.copy(url = modifier.modifyUrl(updated.url ?: updated.givenUrl!!))
                    } else {
                        updated
                    }
                }
            }
        }
    }

    fun getAvailableArchiveTypes(): List<ArchiveType> {
        return _localArchives.value.mapNotNull { ArchiveType.fromArchiveKey(it.archiveKey) }
    }

    override fun onCleared() {
        super.onCleared()
        archiveObserverJob?.cancel()
    }
}
