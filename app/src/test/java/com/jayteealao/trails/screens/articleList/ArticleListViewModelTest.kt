package com.jayteealao.trails.screens.articleList

import android.net.Uri
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.common.ContentMetricsCalculator
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.services.gemini.GeminiClient
import com.jayteealao.trails.services.jina.JinaClient
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockkConstructor
import io.mockk.slot
import io.mockk.unmockkConstructor
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.saket.unfurl.Unfurler
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticleListViewModelTest {

    @MockK private lateinit var articleRepository: ArticleRepository
    @MockK private lateinit var getArticleWithTextUseCase: GetArticleWithTextUseCase
    @MockK private lateinit var articleDao: PocketDao
    @MockK private lateinit var jinaClient: JinaClient
    @MockK private lateinit var geminiClient: GeminiClient

    private val contentMetricsCalculator = ContentMetricsCalculator()
    private lateinit var testDispatcher: CoroutineDispatcher

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        testDispatcher = StandardTestDispatcher()
        Dispatchers.setMain(testDispatcher)

        every { articleRepository.synchronize() } returns Unit
        every { articleRepository.isSyncing } returns flowOf(false)
        every { articleRepository.pockets() } answers { TestPagingSource() }
        every { articleRepository.favoritePockets() } answers { TestPagingSource() }
        every { articleRepository.archivedPockets() } answers { TestPagingSource() }
        every { articleRepository.pocketsByTag(any()) } answers { TestPagingSource() }
        every { articleRepository.allTags() } returns flowOf(emptyList())
        coEvery { articleRepository.searchLocal(any()) } returns emptyList()
        coEvery { articleRepository.searchHybrid(any()) } returns emptyList()
        coEvery { articleRepository.getTags(any()) } returns emptyList()
        coEvery { articleRepository.setFavorite(any(), any()) } returns Unit
        coEvery { articleRepository.addTag(any(), any()) } returns Unit
        coEvery { articleRepository.removeTag(any(), any()) } returns Unit
        coEvery { articleRepository.updateExcerpt(any(), any()) } returns Unit
        every { articleRepository.getArticleById(any()) } returns null
        every { articleRepository.getLastUpdatedArticleTime() } returns 0L
        every { getArticleWithTextUseCase.invoke() } answers { TestPagingSource() }
    }

    @After
    fun tearDown() {
        clearAllMocks()
        runCatching { unmockkConstructor(Unfurler::class) }
        Dispatchers.resetMain()
    }

    @Test
    fun saveUrl_whenMetadataFetchFails_usesSharedUrlAndTitleFallback() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        mockkConstructor(Unfurler::class)
        coEvery { anyConstructed<Unfurler>().unfurl(any()) } throws RuntimeException("unfurl failure")
        val upsertSlot = slot<Article>()
        coEvery { articleDao.upsertArticle(capture(upsertSlot)) } answers { upsertSlot.captured.itemId }

        val updateItemId = slot<String>()
        val updateTitle = slot<String>()
        val updateUrl = slot<String>()
        coEvery {
            articleDao.updateUnfurledDetails(
                capture(updateItemId),
                capture(updateTitle),
                capture(updateUrl),
                any(),
                any(),
                any(),
            )
        } returns Unit
        coEvery { articleDao.updateText(any(), any()) } returns Unit
        coEvery { articleDao.updateArticleMetrics(any(), any(), any(), any()) } returns Unit
        coEvery { jinaClient.getReader(any()) } throws RuntimeException("reader failure")

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        val sharedUrl = "https://example.com/article"
        viewModel.saveUrl(Uri.parse(sharedUrl), "Shared title")
        advanceUntilIdle()

        assertEquals(sharedUrl, upsertSlot.captured.url)
        assertEquals(sharedUrl, upsertSlot.captured.givenUrl)
        assertEquals(upsertSlot.captured.itemId, updateItemId.captured)
        assertEquals("Shared title", updateTitle.captured)
        assertEquals(sharedUrl, updateUrl.captured)
        assertFalse(viewModel.shouldShow.value)
        assertEquals("Shared title", viewModel.intentTitle.value)

        coVerify(exactly = 1) { articleDao.updateUnfurledDetails(any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `requestTagSuggestions with description fetches tags directly`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        val availableTags = listOf("kotlin", "android", "compose")
        every { articleRepository.allTags() } returns flowOf(availableTags)

        val articleItem = ArticleItem(
            itemId = "123",
            title = "Test Article",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = "This is a test description about Kotlin and Android"
        )

        val expectedTags = listOf("kotlin", "android")
        coEvery {
            geminiClient.fetchTagSuggestions(any())
        } returns GeminiClient.TagSuggestionResult.Success(expectedTags)

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        // When
        viewModel.requestTagSuggestions(articleItem)
        advanceUntilIdle()

        // Then
        val suggestions = viewModel.tagSuggestions.value[articleItem.itemId]
        assertEquals(false, suggestions?.isLoading)
        assertEquals(expectedTags, suggestions?.tags)
        assertEquals(null, suggestions?.errorMessage)

        // Verify no summary was fetched (had description)
        coVerify(exactly = 0) { geminiClient.fetchArticleSummary(any()) }
        coVerify(exactly = 1) { geminiClient.fetchTagSuggestions(any()) }
    }

    @Test
    fun `requestTagSuggestions without description fetches summary first`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        val availableTags = listOf("kotlin", "android")
        every { articleRepository.allTags() } returns flowOf(availableTags)

        val articleItem = ArticleItem(
            itemId = "123",
            title = "Test Article",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = null  // No description!
        )

        val generatedSummary = "Generated summary about Kotlin development"
        coEvery {
            geminiClient.fetchArticleSummary(any())
        } returns GeminiClient.ArticleSummaryResult.Success(generatedSummary)

        coEvery {
            articleRepository.updateExcerpt(articleItem.itemId, generatedSummary)
        } returns Unit

        val expectedTags = listOf("kotlin")
        coEvery {
            geminiClient.fetchTagSuggestions(any())
        } returns GeminiClient.TagSuggestionResult.Success(expectedTags)

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        // When
        viewModel.requestTagSuggestions(articleItem)
        advanceUntilIdle()

        // Then
        val suggestions = viewModel.tagSuggestions.value[articleItem.itemId]
        assertEquals(false, suggestions?.isLoading)
        assertEquals(expectedTags, suggestions?.tags)
        assertEquals(null, suggestions?.errorMessage)

        // Verify two-phase flow: summary first, then tags
        coVerify(exactly = 1) { geminiClient.fetchArticleSummary(any()) }
        coVerify(exactly = 1) { articleRepository.updateExcerpt(articleItem.itemId, generatedSummary) }
        coVerify(exactly = 1) { geminiClient.fetchTagSuggestions(any()) }
    }

    @Test
    fun `requestTagSuggestions handles summary fetch failure`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        val availableTags = listOf("kotlin")
        every { articleRepository.allTags() } returns flowOf(availableTags)

        val articleItem = ArticleItem(
            itemId = "123",
            title = "Test Article",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = null  // No description
        )

        coEvery {
            geminiClient.fetchArticleSummary(any())
        } returns GeminiClient.ArticleSummaryResult.Error("Network error")

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        // When
        viewModel.requestTagSuggestions(articleItem)
        advanceUntilIdle()

        // Then
        val suggestions = viewModel.tagSuggestions.value[articleItem.itemId]
        assertEquals(false, suggestions?.isLoading)
        assertEquals(emptyList<String>(), suggestions?.tags)
        assertTrue(suggestions?.errorMessage?.contains("Failed to fetch article summary") == true)

        // Verify summary was attempted but tags were not
        coVerify(exactly = 1) { geminiClient.fetchArticleSummary(any()) }
        coVerify(exactly = 0) { geminiClient.fetchTagSuggestions(any()) }
    }

    @Test
    fun `requestTagSuggestions handles tag fetch failure`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        val availableTags = listOf("kotlin")
        every { articleRepository.allTags() } returns flowOf(availableTags)

        val articleItem = ArticleItem(
            itemId = "123",
            title = "Test Article",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = "Test description"
        )

        coEvery {
            geminiClient.fetchTagSuggestions(any())
        } returns GeminiClient.TagSuggestionResult.Error("API error")

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        // When
        viewModel.requestTagSuggestions(articleItem)
        advanceUntilIdle()

        // Then
        val suggestions = viewModel.tagSuggestions.value[articleItem.itemId]
        assertEquals(false, suggestions?.isLoading)
        assertEquals(emptyList<String>(), suggestions?.tags)
        assertEquals("API error", suggestions?.errorMessage)

        coVerify(exactly = 1) { geminiClient.fetchTagSuggestions(any()) }
    }

    @Test
    fun `requestTagSuggestions does not refetch if already loading`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        every { articleRepository.allTags() } returns flowOf(listOf("kotlin"))

        val articleItem = ArticleItem(
            itemId = "123",
            title = "Test Article",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = "Test description"
        )

        coEvery {
            geminiClient.fetchTagSuggestions(any())
        } coAnswers {
            kotlinx.coroutines.delay(1000)  // Simulate slow response
            GeminiClient.TagSuggestionResult.Success(listOf("kotlin"))
        }

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        // When - request twice before first completes
        viewModel.requestTagSuggestions(articleItem)
        viewModel.requestTagSuggestions(articleItem)  // Should be ignored
        advanceUntilIdle()

        // Then - only one API call should be made
        coVerify(exactly = 1) { geminiClient.fetchTagSuggestions(any()) }
    }

    @Test
    fun `clearTagSuggestionError clears error message`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)

        // Given
        every { articleRepository.allTags() } returns flowOf(emptyList())

        val articleId = "123"
        val articleItem = ArticleItem(
            itemId = articleId,
            title = "Test",
            url = "https://example.com",
            image = null,
            favorite = false,
            isRead = false,
            snippet = "Test"
        )

        coEvery {
            geminiClient.fetchTagSuggestions(any())
        } returns GeminiClient.TagSuggestionResult.Error("Error message")

        val viewModel = ArticleListViewModel(
            pocketRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            articleDao = articleDao,
            jinaClient = jinaClient,
            geminiClient = geminiClient,
            contentMetricsCalculator = contentMetricsCalculator,
            ioDispatcher = dispatcher,
        )

        viewModel.requestTagSuggestions(articleItem)
        advanceUntilIdle()

        // Verify error exists
        assertTrue(viewModel.tagSuggestions.value[articleId]?.errorMessage != null)

        // When
        viewModel.clearTagSuggestionError(articleId)

        // Then
        assertEquals(null, viewModel.tagSuggestions.value[articleId]?.errorMessage)
    }

    private class TestPagingSource : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> =
            LoadResult.Page(emptyList(), prevKey = null, nextKey = null)
    }
}
