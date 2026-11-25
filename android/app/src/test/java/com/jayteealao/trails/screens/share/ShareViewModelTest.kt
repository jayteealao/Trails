package com.jayteealao.trails.screens.share

import androidx.lifecycle.ViewModelStore
import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.SavedArticle
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import javax.inject.Provider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.saket.unfurl.Unfurler
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** What the share sheet shows and starts, over a fake saver. */
@OptIn(ExperimentalCoroutinesApi::class)
class ShareViewModelTest {

    private class FakeSave(link: SharedLink) : LinkSave {
        override val state = MutableStateFlow(LinkSaveState(SavePhase.SAVING, link.title))
        var undos = 0

        override fun undo() {
            undos++
        }

        fun say(phase: SavePhase) {
            state.value = state.value.copy(phase = phase)
        }
    }

    private class FakeSaver : LinkSaver {
        val links = mutableListOf<SharedLink>()
        val saves = mutableListOf<FakeSave>()

        override fun save(link: SharedLink): LinkSave {
            links += link
            return FakeSave(link).also { saves += it }
        }
    }

    private val saver = FakeSaver()
    private val viewModel by lazy { ShareViewModel(saver) }

    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun textWithoutALink_savesNothing_andSaysSo() {
        listOf(null, "", "just words", "ftp://example.com/a", "mailto:mara@example.com").forEach { text ->
            val viewModel = ShareViewModel(saver)
            viewModel.start(text, "A title")
            viewModel.undo()
            viewModel.retry()
            assertEquals("$text", ShareState.NoLink, viewModel.state.value)
        }
        assertTrue(saver.links.isEmpty())
    }

    @Test
    fun aLinkIsSaved_andItsStateIsShownAsItChanges() {
        viewModel.start("Trees https://www.example.com/trees", null)

        assertEquals(listOf(SharedLink("https://www.example.com/trees", "Trees")), saver.links)
        assertEquals(ShareState.Save("Trees", "www.example.com", SavePhase.SAVING), viewModel.state.value)

        saver.saves.single().state.value = LinkSaveState(SavePhase.SAVED, "Counting trees")
        assertEquals(ShareState.Save("Counting trees", "www.example.com", SavePhase.SAVED), viewModel.state.value)
    }

    @Test
    fun aSecondStart_savesNothingAgain() {
        viewModel.start("https://example.com/a", null)
        viewModel.start("https://example.com/a", null)
        viewModel.start("https://example.com/b", null)

        assertEquals(1, saver.links.size)
    }

    @Test
    fun aStartWithoutALink_isNotRepeatedEither() {
        viewModel.start("just words", null)
        viewModel.start("https://example.com/b", null)

        assertEquals(ShareState.NoLink, viewModel.state.value)
        assertTrue(saver.links.isEmpty())
    }

    @Test
    fun anArticleInTheLibrary_isSaid() {
        viewModel.start("https://example.com/a", "Trees")
        saver.saves.single().say(SavePhase.ALREADY_SAVED)

        assertEquals(ShareState.Save("Trees", "example.com", SavePhase.ALREADY_SAVED), viewModel.state.value)
    }

    @Test
    fun undoAsksTheSave() {
        viewModel.start("https://example.com/a", null)
        saver.saves.single().say(SavePhase.SAVED)
        viewModel.undo()

        assertEquals(1, saver.saves.single().undos)
    }

    @Test
    fun retrySavesAgain_afterAFailedSave() {
        viewModel.start("https://example.com/a", null)
        viewModel.retry()
        assertEquals(1, saver.saves.size)

        saver.saves[0].say(SavePhase.NOT_SAVED)
        viewModel.retry()
        assertEquals(2, saver.saves.size)
        assertEquals(saver.links[0], saver.links[1])

        // The first save is not listened to any more.
        saver.saves[1].say(SavePhase.SAVED)
        saver.saves[0].say(SavePhase.SAVING)
        assertEquals(SavePhase.SAVED, (viewModel.state.value as ShareState.Save).phase)
    }

    @Test
    fun retryRemovesAgain_afterAFailedUndo() {
        viewModel.start("https://example.com/a", null)
        saver.saves.single().say(SavePhase.NOT_UNDONE)
        viewModel.retry()

        assertEquals(1, saver.saves.single().undos)
    }

    @Test
    fun closingTheSheet_doesNotCancelTheSave() = runTest {
        val storeMayEnd = CompletableDeferred<Unit>()
        val repository = mockk<ArticleRepository>()
        coEvery { repository.saveNewArticle(any()) } coAnswers {
            storeMayEnd.await()
            SavedArticle(firstArg<Article>().itemId, alreadySaved = false)
        }
        coEvery { repository.getArticleById(any()) } returns null
        coEvery { repository.backupArticleNow(any()) } returns Result.success(Unit)
        every { repository.syncToFirestore() } returns Unit
        val viewModel = ShareViewModel(
            DefaultLinkSaver(repository, Provider { mockk<Unfurler>() }, backgroundScope),
        )
        val store = ViewModelStore().apply { put("share", viewModel) }

        viewModel.start("https://example.com/a", null)
        testScheduler.runCurrent()
        store.clear()
        storeMayEnd.complete(Unit)
        testScheduler.runCurrent()
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.saveNewArticle(any()) }
        coVerify(exactly = 1) { repository.backupArticleNow(any()) }
        verify(exactly = 1) { repository.syncToFirestore() }
    }

    @Test
    fun itDependsOnTheSaverOnly_andHasNoPager() {
        val constructor = ShareViewModel::class.java.constructors.single()
        assertEquals(listOf<Class<*>>(LinkSaver::class.java), constructor.parameterTypes.toList())

        val members = listOf(ShareViewModel::class.java, LinkSaver::class.java).flatMap { type ->
            type.declaredFields.map { it.genericType.typeName } +
                type.declaredMethods.flatMap { method ->
                    (method.genericParameterTypes + method.genericReturnType).map { it.typeName }
                }
        }
        assertTrue(members.isNotEmpty())
        assertTrue("$members", members.none { "androidx.paging" in it })
    }
}
