package com.jayteealao.trails.screens.articleList

import android.net.Uri
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.jayteealao.trails.common.ContentMetricsCalculator
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.ArticleArticle
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.services.archivebox.ArchiveBoxClient
import com.jayteealao.trails.services.jina.JinaClient
import com.jayteealao.trails.services.supabase.SupabaseService
import com.jayteealao.trails.usecases.GetArticleWithTextUseCase
import io.mockk.MockKAnnotations
import io.mockk.anyConstructed
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockkConstructor
import io.mockk.slot
import io.mockk.unmockkConstructor
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import me.saket.unfurl.Unfurler
import org.junit.After
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArticleListViewModelTest {

    @MockK private lateinit var articleRepository: ArticleRepository
    @MockK private lateinit var getArticleWithTextUseCase: GetArticleWithTextUseCase
    @MockK private lateinit var supabaseService: SupabaseService
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var jinaClient: JinaClient
    @MockK private lateinit var archiveBoxClient: ArchiveBoxClient

    private val contentMetricsCalculator = ContentMetricsCalculator()

    @Before
    fun setUp() {
        MockKAnnotations.init(this)
        every { articleRepository.synchronize() } returns Unit
        every { articleRepository.isSyncing } returns flowOf(false)
        every { articleRepository.articles() } answers { TestPagingSource() }
        every { articleRepository.favoriteArticles() } answers { TestPagingSource() }
        every { articleRepository.archivedArticles() } answers { TestPagingSource() }
        every { articleRepository.articlesByTag(any()) } answers { TestPagingSource() }
        every { articleRepository.allTags() } returns flowOf(emptyList())
        coEvery { articleRepository.searchLocal(any()) } returns emptyList()
        coEvery { articleRepository.searchHybrid(any()) } returns emptyList()
        coEvery { articleRepository.getTags(any()) } returns emptyList()
        coEvery { articleRepository.setFavorite(any(), any()) } returns Unit
        coEvery { articleRepository.addTag(any(), any()) } returns Unit
        coEvery { articleRepository.removeTag(any(), any()) } returns Unit
        every { articleRepository.getArticleById(any()) } returns null
        every { articleRepository.getLastUpdatedArticleTime() } returns 0L
        every { getArticleWithTextUseCase.invoke() } answers { TestPagingSource() }
    }

    @After
    fun tearDown() {
        clearAllMocks()
        runCatching { unmockkConstructor(Unfurler::class) }
        runCatching { Dispatchers.resetMain() }
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
            articleRepository = articleRepository,
            getArticleWithTextUseCase = getArticleWithTextUseCase,
            supabaseService = supabaseService,
            articleDao = articleDao,
            jinaClient = jinaClient,
            contentMetricsCalculator = contentMetricsCalculator,
            archiveBoxClient = archiveBoxClient,
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

    private class TestPagingSource : PagingSource<Int, ArticleItem>() {
        override fun getRefreshKey(state: PagingState<Int, ArticleItem>): Int? = null

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ArticleItem> =
            LoadResult.Page(emptyList(), prevKey = null, nextKey = null)
    }
}
