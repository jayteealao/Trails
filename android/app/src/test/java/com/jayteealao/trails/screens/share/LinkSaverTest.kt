package com.jayteealao.trails.screens.share

import android.app.Application
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.SavedArticle
import com.jayteealao.trails.network.di.NetworkModule
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import java.io.IOException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Provider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** One save of one link, with a real page reader over a fake client, on real threads. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class LinkSaverTest {

    private val job = SupervisorJob()
    private val scope = CoroutineScope(job + Dispatchers.Default)

    /** What the save asked of the repository after the store, in order. */
    private val calls = Collections.synchronizedList(mutableListOf<String>())
    private val requests = Collections.synchronizedList(mutableListOf<String>())
    private val stored = AtomicReference<Article?>()
    private val repository = mockk<ArticleRepository>()

    @Volatile private var page: String? = PAGE
    @Volatile private var alreadySaved = false
    @Volatile private var failing = emptySet<String>()

    /** Counted down when a page is asked for; its answer waits for [pageMayAnswer]. */
    private val pageAsked = CountDownLatch(1)
    @Volatile private var pageMayAnswer = CountDownLatch(0)

    private val client = OkHttpClient.Builder().addInterceptor(
        Interceptor { chain ->
            requests += chain.request().url.toString()
            pageAsked.countDown()
            pageMayAnswer.await(10, TimeUnit.SECONDS)
            val body = page ?: throw IOException("offline")
            Response.Builder()
                .request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(body.toResponseBody("text/html".toMediaType()))
                .build()
        },
    ).build()

    private val saver = DefaultLinkSaver(repository, Provider { NetworkModule.provideUnfurler(client) }, scope)

    private fun call(name: String) {
        calls += name
        check(name !in failing) { "raw text" }
    }

    @Before
    fun setUp() {
        coEvery { repository.saveNewArticle(any()) } answers {
            check("save" !in failing) { "raw text" }
            stored.set(firstArg<Article>())
            SavedArticle(firstArg<Article>().itemId, alreadySaved)
        }
        coEvery { repository.getArticleById(any()) } answers { stored.get() }
        coEvery { repository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) } answers {
            call("details")
            stored.set(stored.get()!!.copy(title = secondArg(), url = thirdArg()))
        }
        coEvery { repository.backupArticleNow(any()) } answers {
            calls += "backup"
            if ("backup" in failing) Result.failure(IllegalStateException("raw text")) else Result.success(Unit)
        }
        every { repository.syncToFirestore() } answers { call("sync") }
        coEvery { repository.delete(any()) } answers { call("delete ${firstArg<String>() == stored.get()!!.itemId}") }
    }

    @After
    fun tearDown() {
        pageMayAnswer.countDown()
        scope.cancel()
    }

    private suspend fun LinkSave.await(phase: SavePhase) = withTimeout(10_000) { state.first { it.phase == phase } }

    /** Waits until nothing of the saver runs. */
    private suspend fun idle() = withTimeout(10_000) {
        while (true) (job.children.firstOrNull { !it.isCompleted } ?: break).join()
    }

    private fun test(block: suspend CoroutineScope.() -> Unit) = runBlocking(block = block)

    @Test
    fun aNewLinkIsStored_itsPageIsReadWithTheInjectedClient_thenItIsBackedUp() = test {
        pageMayAnswer = CountDownLatch(1)
        val save = saver.save(SharedLink(URL, ""))
        assertEquals("example.com/article?b=c", save.state.value.title)
        save.await(SavePhase.SAVED)
        pageMayAnswer.countDown()
        idle()

        assertEquals(listOf(URL), requests)
        assertEquals(LinkSaveState(SavePhase.SAVED, "Page title"), save.state.value)
        assertEquals(listOf("details", "backup", "sync"), calls)
        assertEquals(URL, stored.get()!!.givenUrl)
    }

    @Test
    fun savedIsSaidBeforeThePageAnswers() = test {
        pageMayAnswer = CountDownLatch(1)
        val save = saver.save(SharedLink(URL, "Shared title"))

        assertEquals("Shared title", save.await(SavePhase.SAVED).title)
        assertTrue(pageAsked.await(10, TimeUnit.SECONDS))
        assertTrue(calls.isEmpty())

        pageMayAnswer.countDown()
        idle()
        assertEquals("Page title", save.state.value.title)
    }

    @Test
    fun theSharedTitleAndAddressAreStored_andAnUnreadPageWritesNothingMore() = test {
        page = null
        val save = saver.save(SharedLink(URL, "Shared title"))
        save.await(SavePhase.SAVED)
        idle()

        with(stored.get()!!) {
            assertEquals(URL, url)
            assertEquals(URL, givenUrl)
            assertEquals("Shared title", title)
            assertEquals("Shared title", givenTitle)
        }
        assertEquals(LinkSaveState(SavePhase.SAVED, "Shared title"), save.state.value)
        assertEquals(listOf("backup", "sync"), calls)
    }

    @Test
    fun whatFailsAfterTheStore_neverChangesThePhase_andTheSyncStillStarts() = test {
        failing = setOf("details", "backup")
        val save = saver.save(SharedLink(URL, "Shared title"))
        save.await(SavePhase.SAVED)
        idle()

        assertEquals(LinkSaveState(SavePhase.SAVED, "Shared title"), save.state.value)
        assertEquals(listOf("details", "backup", "sync"), calls)
    }

    @Test
    fun aFailedStoreIsSaid_inNoRawWords() = test {
        failing = setOf("save")
        val save = saver.save(SharedLink(URL, "Shared title"))

        assertEquals("Shared title", save.await(SavePhase.NOT_SAVED).title)
        save.undo()
        idle()
        assertEquals(SavePhase.NOT_SAVED, save.state.value.phase)
        assertTrue(requests.isEmpty() && calls.isEmpty())
    }

    @Test
    fun aLinkInTheLibraryIsSaid_andCannotBeUndone() = test {
        alreadySaved = true
        val save = saver.save(SharedLink(URL, "Shared title"))
        save.await(SavePhase.ALREADY_SAVED)
        save.undo()
        idle()

        assertEquals(SavePhase.ALREADY_SAVED, save.state.value.phase)
        assertEquals(listOf("details", "backup", "sync"), calls)
    }

    @Test
    fun undoWhileThePageLoads_removesTheArticle_andBacksNothingUp() = test {
        pageMayAnswer = CountDownLatch(1)
        val save = saver.save(SharedLink(URL, "Shared title"))
        save.await(SavePhase.SAVED)
        assertTrue(pageAsked.await(10, TimeUnit.SECONDS))

        save.undo()
        save.await(SavePhase.UNDONE)
        save.undo()
        pageMayAnswer.countDown()
        idle()

        assertEquals(LinkSaveState(SavePhase.UNDONE, "Shared title"), save.state.value)
        assertEquals(listOf("delete true", "sync"), calls)
    }

    @Test
    fun aFailedUndoIsSaid_andWorksAgain() = test {
        val save = saver.save(SharedLink(URL, "Shared title"))
        save.await(SavePhase.SAVED)
        idle()
        calls.clear()
        failing = setOf("delete true")

        save.undo()
        save.await(SavePhase.NOT_UNDONE)
        failing = emptySet()
        save.undo()
        save.await(SavePhase.UNDONE)

        assertEquals(listOf("delete true", "delete true", "sync"), calls)
    }

    @Test
    fun theSaveEnds_althoughItsCallerIsCancelled() = test {
        pageMayAnswer = CountDownLatch(1)
        val caller = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        caller.launch { saver.save(SharedLink(URL, "Shared title")) }.join()
        assertTrue(pageAsked.await(10, TimeUnit.SECONDS))

        caller.cancel()
        pageMayAnswer.countDown()
        idle()

        assertEquals(listOf("details", "backup", "sync"), calls)
    }

    private companion object {
        const val URL = "https://example.com/article?b=c"
        const val PAGE = "<html><head><title>Page title</title></head><body></body></html>"
    }
}
