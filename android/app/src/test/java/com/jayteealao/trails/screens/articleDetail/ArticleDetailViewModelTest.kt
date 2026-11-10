package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.common.UrlModifier
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
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.just
import io.mockk.Runs
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
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
        every { archiveService.observeDownloads(any()) } returns flowOf(emptyMap())
        coEvery { archiveService.applyWargMetadata(any()) } just Runs
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

    // ----- The stored text is ranked before the one read of an open -----

    /** The article row the fake repository holds; [ArticleRepository.offerArticleText] writes it by the rank. */
    private var stored: Article? = null

    private fun storeArticle(itemId: String, text: String?, source: String) {
        stored = Article(
            itemId = itemId,
            url = "https://example.com/$itemId",
            givenUrl = "https://example.com/$itemId",
            text = text,
            textSource = source,
        )
        coEvery { articleRepository.getArticleById(itemId) } answers { stored }
        coEvery { articleRepository.offerArticleText(itemId, any(), any()) } answers {
            val newText = secondArg<String>()
            val newSource = thirdArg<String>()
            val current = stored!!
            val replace = TextSourceRank.shouldReplace(current.text, current.textSource, newSource, newText)
            if (replace) stored = current.copy(text = newText, textSource = newSource)
            replace
        }
    }

    private fun localArchive(itemId: String, type: ArchiveType) = LocalArchive(
        itemId = itemId,
        archiveKey = type.archiveKey,
        localPath = "/path/${type.localFilename}",
        compressedSizeBytes = 100L,
        originalSizeBytes = 500L,
        downloadedAt = 0L,
    )

    @Test
    fun open_offersReadabilityBeforeTheOneRead() = runTest(scheduler) {
        storeArticle("a4", null, "")
        // Markdown first in the list, so the rank, not the list order, picks Readability.
        val archives = listOf(localArchive("a4", ArchiveType.MARKDOWN), localArchive("a4", ArchiveType.READABILITY))
        coEvery { localArchiveDao.getArchivesForArticle("a4") } returns archives
        every { localArchiveDao.observeArchives("a4") } returns flowOf(archives)
        coEvery { archiveService.readArchiveText("a4", ArchiveType.READABILITY) } returns "readability content"
        coEvery { archiveService.readArchiveText("a4", ArchiveType.MARKDOWN) } returns "markdown content"

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a4")
        advanceUntilIdle()

        coVerifyOrder {
            articleRepository.offerArticleText("a4", "readability content", "readability")
            articleRepository.getArticleById("a4")
        }
        coVerify(exactly = 1) { articleRepository.getArticleById("a4") }
        coVerify(exactly = 0) { archiveService.readArchiveText("a4", ArchiveType.MARKDOWN) }
        assertEquals("readability content", viewModel.state.value.article?.text)
        assertEquals("readability", viewModel.state.value.textSource)
        collectJob.cancel()
    }

    @Test
    fun open_markdownOnly_offersMarkdown() = runTest(scheduler) {
        storeArticle("a5", null, "")
        val archives = listOf(localArchive("a5", ArchiveType.MARKDOWN))
        coEvery { localArchiveDao.getArchivesForArticle("a5") } returns archives
        every { localArchiveDao.observeArchives("a5") } returns flowOf(archives)
        coEvery { archiveService.readArchiveText("a5", ArchiveType.MARKDOWN) } returns "markdown content"

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a5")
        advanceUntilIdle()

        coVerify(atLeast = 1) { articleRepository.offerArticleText("a5", "markdown content", "markdown") }
        assertEquals("markdown content", viewModel.state.value.article?.text)
        collectJob.cancel()
    }

    /** Opens a6 with stored Markdown text, then a Readability archive arrives while it is open. */
    private fun TestScope.openThenReadabilityArrives(): ArticleDetailViewModel {
        storeArticle("a6", "markdown text", "markdown")
        val markdown = localArchive("a6", ArchiveType.MARKDOWN)
        val readability = localArchive("a6", ArchiveType.READABILITY)
        val localFlow = MutableSharedFlow<List<LocalArchive>>(replay = 1)
        coEvery { localArchiveDao.getArchivesForArticle("a6") } returns listOf(markdown)
        every { localArchiveDao.observeArchives("a6") } returns localFlow
        coEvery { archiveService.readArchiveText("a6", ArchiveType.MARKDOWN) } returns "markdown text"
        coEvery { archiveService.readArchiveText("a6", ArchiveType.READABILITY) } returns "readability text"

        val viewModel = buildViewModel()
        viewModel.state.onEach { }.launchIn(backgroundScope)
        viewModel.getArticle("a6")
        advanceUntilIdle()

        coEvery { localArchiveDao.getArchivesForArticle("a6") } returns listOf(markdown, readability)
        localFlow.tryEmit(listOf(markdown, readability))
        advanceUntilIdle()
        return viewModel
    }

    @Test
    fun betterSourceArrives_textOnScreenStaysTheSame() = runTest(scheduler) {
        val viewModel = openThenReadabilityArrives()

        coVerify(exactly = 1) { articleRepository.offerArticleText("a6", "readability text", "readability") }
        assertEquals("markdown text", viewModel.state.value.article?.text)
        assertEquals("markdown", viewModel.state.value.textSource)
        assertEquals("readability", stored?.textSource)
    }

    @Test
    fun betterSourceArrived_nextOpenShowsTheBetterText() = runTest(scheduler) {
        val viewModel = openThenReadabilityArrives()

        viewModel.getArticle("a6")
        advanceUntilIdle()

        assertEquals("readability text", viewModel.state.value.article?.text)
        assertEquals("readability", viewModel.state.value.textSource)
    }

    @Test
    fun firstTextArrives_showsWhenNoTextWasOnScreen() = runTest(scheduler) {
        storeArticle("a7", null, "")
        val localFlow = MutableSharedFlow<List<LocalArchive>>(replay = 1)
        every { localArchiveDao.observeArchives("a7") } returns localFlow
        coEvery { archiveService.readArchiveText("a7", ArchiveType.MARKDOWN) } returns "markdown text"

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a7")
        advanceUntilIdle()
        assertNull(viewModel.state.value.article?.text)

        localFlow.tryEmit(listOf(localArchive("a7", ArchiveType.MARKDOWN)))
        advanceUntilIdle()

        assertEquals("markdown text", viewModel.state.value.article?.text)
        assertEquals("markdown", viewModel.state.value.textSource)
        collectJob.cancel()
    }

    @Test
    fun manualPick_offersThroughTheRank_andLeavesTheReaderText() = runTest(scheduler) {
        storeArticle("a8", "readability text", "readability")
        val archives = listOf(localArchive("a8", ArchiveType.READABILITY), localArchive("a8", ArchiveType.MARKDOWN))
        coEvery { localArchiveDao.getArchivesForArticle("a8") } returns archives
        every { localArchiveDao.observeArchives("a8") } returns flowOf(archives)
        coEvery { archiveService.readArchiveText("a8", ArchiveType.READABILITY) } returns "readability text"
        coEvery { archiveService.readArchiveText("a8", ArchiveType.MARKDOWN) } returns "markdown content"

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a8")
        advanceUntilIdle()

        val markdownTab = 2 + viewModel.getAvailableArchiveTypes().indexOf(ArchiveType.MARKDOWN)
        viewModel.setSelectedTab(markdownTab)
        advanceUntilIdle()

        coVerify(exactly = 1) { articleRepository.offerArticleText("a8", "markdown content", "markdown") }
        assertEquals("markdown content", viewModel.state.value.selectedArchiveContent)
        assertEquals("readability text", viewModel.state.value.article?.text)
        assertEquals("readability", stored?.textSource)
        collectJob.cancel()
    }

    // ----- Warg metadata is applied after the archives sync -----

    private fun archivedArticle(itemId: String) = Article(
        itemId = itemId,
        url = "https://example.com/$itemId",
        givenUrl = "https://example.com/$itemId",
        text = "already populated",
    )

    @Test
    fun remoteArchives_syncThenApplyWargMetadata() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a9") } returns archivedArticle("a9")
        every { archiveService.observeRemoteArchives("a9") } returns
            flowOf(mapOf("readability" to ArchiveStatus("success", "gs://x")))
        coEvery { archiveService.syncArchives(any(), any()) } just Runs
        coEvery { archiveService.applyWargMetadata("a9") } just Runs

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a9")
        advanceUntilIdle()

        coVerifyOrder {
            archiveService.syncArchives("a9", any())
            archiveService.applyWargMetadata("a9")
        }
        collectJob.cancel()
    }

    @Test
    fun remoteArchives_applyWargMetadataFailure_doesNotCrashOrStaySyncing() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a10") } returns archivedArticle("a10")
        every { archiveService.observeRemoteArchives("a10") } returns
            flowOf(mapOf("readability" to ArchiveStatus("success", "gs://x")))
        coEvery { archiveService.syncArchives(any(), any()) } just Runs
        coEvery { archiveService.applyWargMetadata("a10") } throws IllegalStateException("boom")

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a10")
        advanceUntilIdle()

        coVerify(exactly = 1) { archiveService.applyWargMetadata("a10") }
        assertFalse(viewModel.state.value.archiveSyncing)
        assertEquals("a10", viewModel.state.value.article?.itemId)
        collectJob.cancel()
    }

    @Test
    fun noRemoteArchives_doesNotApplyWargMetadata() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a11") } returns archivedArticle("a11")

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a11")
        advanceUntilIdle()

        coVerify(exactly = 0) { archiveService.applyWargMetadata(any()) }
        collectJob.cancel()
    }

    // ----- The syncing flag follows the text downloads, not the heavy ones -----

    @Test
    fun textDownloadEnds_syncingEndsWhileAHeavyDownloadRuns() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a12") } returns archivedArticle("a12")
        val downloads = MutableStateFlow(
            mapOf("readability" to ArchiveDownload.DOWNLOADING, "monolith" to ArchiveDownload.DOWNLOADING),
        )
        every { archiveService.observeDownloads("a12") } returns downloads

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a12")
        advanceUntilIdle()
        assertTrue(viewModel.state.value.archiveSyncing)

        downloads.value = mapOf("monolith" to ArchiveDownload.DOWNLOADING)
        advanceUntilIdle()
        assertFalse(viewModel.state.value.archiveSyncing)
        collectJob.cancel()
    }

    @Test
    fun failedHeavyDownload_isNotSyncing() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a13") } returns archivedArticle("a13")
        every { archiveService.observeDownloads("a13") } returns
            MutableStateFlow(mapOf("monolith" to ArchiveDownload.FAILED))

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a13")
        advanceUntilIdle()

        assertFalse(viewModel.state.value.archiveSyncing)
        collectJob.cancel()
    }

    @Test
    fun eachRemoteEmit_syncsAndAppliesMetadata_whileAHeavyDownloadRuns() = runTest(scheduler) {
        coEvery { articleRepository.getArticleById("a14") } returns archivedArticle("a14")
        every { archiveService.observeRemoteArchives("a14") } returns flowOf(
            mapOf("monolith" to ArchiveStatus("success", "gs://x/monolith")),
            mapOf(
                "monolith" to ArchiveStatus("success", "gs://x/monolith"),
                "readability" to ArchiveStatus("success", "gs://x/readability"),
            ),
        )
        every { archiveService.observeDownloads("a14") } returns
            MutableStateFlow(mapOf("monolith" to ArchiveDownload.DOWNLOADING))
        coEvery { archiveService.syncArchives(any(), any()) } just Runs

        val viewModel = buildViewModel()
        val collectJob: Job = viewModel.state.onEach { }.launchIn(this)
        viewModel.getArticle("a14")
        advanceUntilIdle()

        coVerify(exactly = 2) { archiveService.syncArchives("a14", any()) }
        coVerify(exactly = 2) { archiveService.applyWargMetadata("a14") }
        assertFalse(viewModel.state.value.archiveSyncing)
        collectJob.cancel()
    }
}
