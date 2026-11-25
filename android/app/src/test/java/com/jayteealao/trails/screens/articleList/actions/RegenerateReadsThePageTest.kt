package com.jayteealao.trails.screens.articleList.actions

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.FakeLibraryStatus
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.di.NetworkModule
import com.jayteealao.trails.screens.articleList.ArticleListViewModel
import com.jayteealao.trails.screens.articleSearch.ArticleSearchViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** Each regenerate reads the page, whatever the read before it gave, with the reader of the app. */
@OptIn(ExperimentalCoroutinesApi::class)
class RegenerateReadsThePageTest {

    private val repository = mockk<ArticleRepository>(relaxed = true) {
        every { isSyncing } returns flowOf(false)
        every { allTags() } returns flowOf(emptyList())
        coEvery { getArticleById("a") } returns Article(itemId = "a", url = "https://example.com/a")
    }
    private val row = ArticleItem(itemId = "a", title = "A river", url = "https://example.com/a")
    private val reads = AtomicInteger()

    // Null is a phone without a network.
    @Volatile private var title: String? = null

    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            reads.incrementAndGet()
            val words = title ?: throw IOException("offline")
            Response.Builder()
                .request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("<html><head><title>$words</title></head></html>".toResponseBody("text/html".toMediaType()))
                .build()
        }
        .build()

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    /** Offline, then with the network back, then the page changes, then offline again. */
    private fun readsThePageEachTime(events: Flow<*>, regenerate: () -> Unit) = runBlocking {
        val ends = Channel<Unit>(Channel.UNLIMITED)
        val collecting = launch(Dispatchers.Unconfined) { events.collect { ends.send(Unit) } }
        listOf(null, "A river in winter", "A river in spring", null).forEachIndexed { index, words ->
            title = words
            regenerate()
            withTimeout(10_000) { ends.receive() }
            assertEquals(index + 1, reads.get())
        }
        collecting.cancel()
        coVerifyOrder {
            repository.updateUnfurledDetails("a", "A river in winter", any(), any(), any(), any(), any())
            repository.updateUnfurledDetails("a", "A river in spring", any(), any(), any(), any(), any())
        }
        coVerify(exactly = 2) { repository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun aRegenerateInTheList_readsThePageEachTime() {
        val viewModel = ArticleListViewModel(
            repository,
            FakeLibraryStatus(LibraryState(hasArticles = true)),
            { NetworkModule.provideUnfurler(client) },
            Dispatchers.Unconfined,
        )
        readsThePageEachTime(viewModel.event) { viewModel.regenerateArticleDetails("a") }
    }

    @Test
    fun aRegenerateInSearch_readsThePageEachTime() {
        val viewModel = ArticleSearchViewModel(
            repository, { NetworkModule.provideUnfurler(client) }, Dispatchers.Unconfined,
        )
        readsThePageEachTime(viewModel.event) { viewModel.runAction(ArticleAction.REGENERATE, row) }
    }

    @Test
    fun theReaderIsNotShared() {
        val provider = NetworkModule::class.java.methods.single { it.name == "provideUnfurler" }
        assertNull(provider.getAnnotation(Singleton::class.java))
    }
}
