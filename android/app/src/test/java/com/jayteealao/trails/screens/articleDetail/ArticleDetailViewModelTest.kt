package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.common.UrlModifier
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.archive.ArchiveService
import com.jayteealao.trails.data.archive.ArchiveStatus
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.screens.settings.SettingsPreferenceKeys
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for ArticleDetailViewModel covering the four quality/reuse changes:
 *   - Nested combine() — no cast exceptions (B4 / quality-4)
 *   - Typed SettingsPreferenceKeys.USE_FREEDIUM filter (B4 / quality-6)
 *   - Injected UrlModifier singleton (B4 / reuse-5)
 *   - ArchiveType enum constants instead of magic strings (B4 / reuse-11)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArticleDetailViewModelTest {

    @MockK private lateinit var articleRepository: ArticleRepository
    @MockK private lateinit var sharedPreferencesManager: SharedPreferencesManager
    @MockK private lateinit var archiveService: ArchiveService
    @MockK private lateinit var localArchiveDao: LocalArchiveDao
    @MockK private lateinit var urlModifier: UrlModifier

    private val preferenceChangesFlow = MutableSharedFlow<String?>(extraBufferCapacity = 64)

    private val scheduler = TestCoroutineScheduler()
    private val testDispatcher = StandardTestDispatcher(scheduler)

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        Dispatchers.setMain(testDispatcher)

        // Default stubs — overridden per test as needed
        every { sharedPreferencesManager.preferenceChangesFlow() } returns preferenceChangesFlow
        every { sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM) } returns false
        every { sharedPreferencesManager.getBoolean(any(), any()) } returns false

        // Minimal stubs for archive operations (loadArchives path not exercised in most tests)
        coEvery { localArchiveDao.getArchivesForArticle(any()) } returns emptyList()
        every { localArchiveDao.observeArchives(any()) } returns emptyFlow()
        every { archiveService.observeRemoteArchives(any()) } returns emptyFlow()
    }

    @After
    fun tearDown() {
        clearAllMocks()
        Dispatchers.resetMain()
    }

    /**
     * Builds a fresh ViewModel with the shared testDispatcher so viewModelScope and
     * ioDispatcher share the same TestCoroutineScheduler — required for advanceUntilIdle()
     * to drain all coroutines.
     */
    private fun buildViewModel(): ArticleDetailViewModel = ArticleDetailViewModel(
        articleRepository = articleRepository,
        sharedPreferencesManager = sharedPreferencesManager,
        archiveService = archiveService,
        localArchiveDao = localArchiveDao,
        urlModifier = urlModifier,
        ioDispatcher = testDispatcher,
    )

    // ----- AC: state assembly — initial defaults -----

    @Test
    fun stateAssembly_initialState_hasDefaultValues() = runTest(scheduler) {
        val viewModel = buildViewModel()
        // Subscribe so WhileSubscribed activates the upstream combine chain
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        advanceUntilIdle()

        val s = viewModel.state.value
        assertNull(s.article)
        assertEquals(1, s.selectedTabIndex)
        assertFalse(s.useFreedium)
        assertFalse(s.isLoading)
        assertEquals(emptyMap<String, ArchiveStatus>(), s.remoteArchives)
        assertEquals(emptyList<LocalArchive>(), s.localArchives)
        assertFalse(s.archiveSyncing)
        assertEquals("", s.textSource)
        assertNull(s.selectedArchiveContent)

        collectJob.cancel()
    }

    // ----- AC: state assembly — getArticle populates article field -----

    @Test
    fun stateAssembly_getArticle_populatesArticleField() = runTest(scheduler) {
        val article = Article(
            itemId = "a1",
            url = "https://example.com",
            givenUrl = "https://example.com"
        )
        coEvery { articleRepository.getArticleById("a1") } returns article

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        advanceUntilIdle()

        viewModel.getArticle("a1")
        advanceUntilIdle()

        assertEquals("a1", viewModel.state.value.article?.itemId)
        collectJob.cancel()
    }

    // ----- AC: state assembly — setSelectedTab updates tabIndex -----

    @Test
    fun stateAssembly_setSelectedTab_updatesTabIndex() = runTest(scheduler) {
        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        advanceUntilIdle()

        viewModel.setSelectedTab(2)
        advanceUntilIdle()

        assertEquals(2, viewModel.state.value.selectedTabIndex)
        collectJob.cancel()
    }

    // ----- AC: useFreediumFlow filter — unrelated key does not change state -----

    @Test
    fun useFreediumFlow_unrelatedKey_doesNotChangeUseFreedium() = runTest(scheduler) {
        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        advanceUntilIdle()

        preferenceChangesFlow.emit("DARK_MODE_ENABLED")
        advanceUntilIdle()

        assertFalse(viewModel.state.value.useFreedium)
        collectJob.cancel()
    }

    // ----- AC: useFreediumFlow filter — correct key toggles useFreedium -----

    @Test
    fun useFreediumFlow_correctKey_updatesUseFreedium() = runTest(scheduler) {
        every { sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM) } returns false
        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        advanceUntilIdle()

        // Simulate preference toggle
        every { sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM) } returns true
        preferenceChangesFlow.emit(SettingsPreferenceKeys.USE_FREEDIUM)
        advanceUntilIdle()

        assertTrue(viewModel.state.value.useFreedium)
        collectJob.cancel()
    }

    // ----- AC: UrlModifier injection — injected instance used when useFreedium=true -----

    @Test
    fun getArticle_useFreediumTrue_callsInjectedUrlModifier() = runTest(scheduler) {
        every { sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM) } returns true
        val article = Article(
            itemId = "a2",
            url = "https://medium.com/test",
            givenUrl = "https://medium.com/test"
        )
        coEvery { articleRepository.getArticleById("a2") } returns article
        every { urlModifier.modifyUrl(any()) } returns "https://freedium.cfd/medium.com/test"

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a2")
        advanceUntilIdle()

        verify(atLeast = 1) { urlModifier.modifyUrl(any()) }
        collectJob.cancel()
    }

    @Test
    fun getArticle_useFreediumFalse_doesNotCallUrlModifier() = runTest(scheduler) {
        every { sharedPreferencesManager.getBoolean(SettingsPreferenceKeys.USE_FREEDIUM) } returns false
        val article = Article(
            itemId = "a3",
            url = "https://medium.com/test",
            givenUrl = "https://medium.com/test"
        )
        coEvery { articleRepository.getArticleById("a3") } returns article

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a3")
        advanceUntilIdle()

        verify(exactly = 0) { urlModifier.modifyUrl(any()) }
        collectJob.cancel()
    }

    // ----- AC: archive key constants — readability preferred over markdown -----

    @Test
    fun autoPopulateText_prefersReadabilityOverMarkdown() = runTest(scheduler) {
        val readabilityArchive = LocalArchive(
            itemId = "a4",
            archiveKey = ArchiveType.READABILITY.archiveKey,
            localPath = "/path/readability.gz",
            compressedSizeBytes = 100L,
            originalSizeBytes = 500L,
            downloadedAt = 0L,
        )
        val markdownArchive = LocalArchive(
            itemId = "a4",
            archiveKey = ArchiveType.MARKDOWN.archiveKey,
            localPath = "/path/markdown.gz",
            compressedSizeBytes = 80L,
            originalSizeBytes = 400L,
            downloadedAt = 0L,
        )
        // Archives list ordered markdown-first to confirm selection logic (not just list order)
        val archives = listOf(markdownArchive, readabilityArchive)

        val article = Article(
            itemId = "a4",
            url = "https://example.com",
            givenUrl = "https://example.com",
            text = null
        )
        coEvery { articleRepository.getArticleById("a4") } returns article
        coEvery { localArchiveDao.getArchivesForArticle("a4") } returns archives
        every { localArchiveDao.observeArchives("a4") } returns flowOf(archives)
        coEvery { archiveService.readArchiveText("a4", ArchiveType.READABILITY) } returns "readability content"
        coEvery { archiveService.readArchiveText("a4", ArchiveType.MARKDOWN) } returns "markdown content"
        coEvery { articleRepository.updateArticleText(any(), any(), any()) } returns Unit

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a4")
        advanceUntilIdle()

        // readArchiveText should be called for READABILITY but not MARKDOWN
        coVerify(atLeast = 1) { archiveService.readArchiveText("a4", ArchiveType.READABILITY) }
        coVerify(exactly = 0) { archiveService.readArchiveText("a4", ArchiveType.MARKDOWN) }
        collectJob.cancel()
    }

    @Test
    fun autoPopulateText_markdownFallback_whenNoReadability() = runTest(scheduler) {
        val markdownArchive = LocalArchive(
            itemId = "a5",
            archiveKey = ArchiveType.MARKDOWN.archiveKey,
            localPath = "/path/markdown.gz",
            compressedSizeBytes = 80L,
            originalSizeBytes = 400L,
            downloadedAt = 0L,
        )
        val archives = listOf(markdownArchive)

        val article = Article(
            itemId = "a5",
            url = "https://example.com",
            givenUrl = "https://example.com",
            text = null
        )
        coEvery { articleRepository.getArticleById("a5") } returns article
        coEvery { localArchiveDao.getArchivesForArticle("a5") } returns archives
        every { localArchiveDao.observeArchives("a5") } returns flowOf(archives)
        coEvery { archiveService.readArchiveText("a5", ArchiveType.MARKDOWN) } returns "markdown content"
        coEvery { articleRepository.updateArticleText(any(), any(), any()) } returns Unit

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a5")
        advanceUntilIdle()

        coVerify(atLeast = 1) { archiveService.readArchiveText("a5", ArchiveType.MARKDOWN) }
        collectJob.cancel()
    }
}
