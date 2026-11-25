package com.jayteealao.trails.screens.articleList.actions

import com.jayteealao.trails.data.ArticleRepository
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.ARCHIVE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.COPY_LINK
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.DELETE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.FAVOURITE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.OPEN
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.READ
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.REGENERATE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.SHARE
import com.jayteealao.trails.screens.components.ErrorMessage
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import me.saket.unfurl.Unfurler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What each action does, and what the open sheet shows while it runs and after it. */
@OptIn(ExperimentalCoroutinesApi::class)
class ArticleActionRunnerTest {

    private val repository = mockk<ArticleRepository>(relaxed = true)
    private val events = mutableListOf<ArticleActionEvent>()
    private val saved = mutableListOf<ArticleChange>()
    private val details = mutableListOf<String>()
    private var refreshes = 0
    private var refresh: suspend (String) -> DetailsRefresh = { UPDATED }

    private val dispatcher = StandardTestDispatcher()
    private val scope = CoroutineScope(dispatcher + Job())
    private val runner = ArticleActionRunner(
        repository = repository,
        scope = scope,
        dispatcher = dispatcher,
        refreshDetails = { refreshes++; refresh(it) },
        emit = { events += it },
        onSaved = { saved += it },
        onDetails = { itemId, _ -> details += itemId },
    )

    private suspend fun sheet() = runner.sheet.first()

    private fun test(body: suspend TestScope.() -> Unit) = runTest(dispatcher) { body() }

    private fun failures() = events.filterIsInstance<ArticleActionEvent.Failed>()

    @Test
    fun eachAction_reachesItsCallOrItsEvent() = test {
        listOf(FAVOURITE, READ, ARCHIVE, DELETE, REGENERATE).forEach { runner.run(it, A) }
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.setFavorite("a", true) }
        coVerify(exactly = 1) { repository.setReadStatus("a", true) }
        coVerify(exactly = 1) { repository.archive("a") }
        coVerify(exactly = 1) { repository.delete("a") }
        assertEquals(1, refreshes)
        assertEquals(listOf("a"), details)
        assertTrue(ArticleActionEvent.Say("Article archived") in events)
        assertTrue(ArticleActionEvent.Say("Article details updated") in events)
        assertEquals(4, saved.size)

        events.clear()
        listOf(OPEN, SHARE, COPY_LINK).forEach { runner.run(it, A) }
        advanceUntilIdle()
        assertEquals(
            listOf(
                ArticleActionEvent.Open(A.url),
                ArticleActionEvent.Share(A.title, A.url),
                ArticleActionEvent.Copy(A.url),
            ),
            events,
        )
    }

    @Test
    fun aFavouriteThatWasRead_isTurnedBack() = test {
        listOf(FAVOURITE, READ).forEach { runner.run(it, A.copy(favorite = true, isRead = true)) }
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.setFavorite("a", false) }
        coVerify(exactly = 1) { repository.setReadStatus("a", false) }
    }

    @Test
    fun withoutAnAddress_theLinkActionsDoNothing() = test {
        listOf(OPEN, SHARE, COPY_LINK).forEach { runner.run(it, A.copy(url = "")) }
        advanceUntilIdle()

        assertEquals(emptyList<ArticleActionEvent>(), events)
    }

    @Test
    fun aChange_closesTheSheetOnlyAfterItIsSaved_andADoubleTapRunsOnce() = test {
        val answer = CompletableDeferred<Unit>()
        coEvery { repository.setFavorite("a", true) } coAnswers { answer.await() }
        runner.openSheet(A)

        runner.choose(FAVOURITE)
        runner.choose(FAVOURITE)
        advanceUntilIdle()
        assertEquals(ArticleSheet(A), sheet())

        answer.complete(Unit)
        advanceUntilIdle()
        assertNull(sheet())
        coVerify(exactly = 1) { repository.setFavorite("a", true) }
        assertEquals(listOf<ArticleChange>(ArticleChange.Favourite("a", true)), saved)
    }

    @Test
    fun aFailure_staysInTheSheet_andASecondChoiceWorks() = test {
        coEvery { repository.setFavorite("a", true) } throws IllegalStateException("raw") andThen Unit
        runner.openSheet(A)

        runner.choose(FAVOURITE)
        advanceUntilIdle()
        assertEquals("Add to favourites was not saved on this phone. Choose it again to retry.", sheet()?.failure)
        assertEquals(emptyList<ArticleActionEvent>(), events)

        runner.choose(FAVOURITE)
        advanceUntilIdle()
        assertNull(sheet())
        assertEquals(1, saved.size)
    }

    @Test
    fun aFailure_afterTheSheetClosed_isAMessageWithARetry() = test {
        coEvery { repository.archive("a") } throws IllegalStateException("raw") andThen Unit
        runner.openSheet(A)
        runner.choose(ARCHIVE)
        runner.closeSheet()
        advanceUntilIdle()

        assertEquals(listOf(ErrorMessage.CHANGE_FAILED), failures().map { it.message })
        failures().single().retry!!.invoke()
        advanceUntilIdle()
        coVerify(exactly = 2) { repository.archive("a") }
    }

    @Test
    fun delete_closesAtOnce_andItsUndoRestores() = test {
        runner.openSheet(A)
        runner.choose(DELETE)
        assertNull(sheet())
        advanceUntilIdle()

        (events.single() as ArticleActionEvent.Deleted).undo()
        advanceUntilIdle()
        coVerify(exactly = 1) { repository.delete("a") }
        coVerify(exactly = 1) { repository.restore("a") }
        assertEquals(listOf(ArticleChange.Delete("a"), ArticleChange.Restore("a")), saved)
    }

    @Test
    fun aDeleteOrAnUndoThatFails_isAMessageWithARetry() = test {
        coEvery { repository.delete("a") } throws IllegalStateException("raw") andThen Unit
        coEvery { repository.restore("a") } throws IllegalStateException("raw") andThen Unit
        runner.openSheet(A)
        runner.choose(DELETE)
        advanceUntilIdle()
        assertEquals(1, failures().size)

        failures().last().retry!!.invoke()
        advanceUntilIdle()
        events.filterIsInstance<ArticleActionEvent.Deleted>().single().undo()
        advanceUntilIdle()
        assertEquals(2, failures().size)

        failures().last().retry!!.invoke()
        advanceUntilIdle()
        coVerify(exactly = 2) { repository.restore("a") }
    }

    @Test
    fun theLinkActions_closeTheSheet() = test {
        listOf(OPEN, SHARE, COPY_LINK).forEach {
            runner.openSheet(A)
            runner.choose(it)
            assertNull(sheet())
        }
        advanceUntilIdle()
        assertEquals(3, events.size)
    }

    @Test
    fun aRegenerate_marksOnlyItsArticle_runsOnce_andSurvivesAClosedSheet() = test {
        val answer = CompletableDeferred<DetailsRefresh>()
        refresh = { answer.await() }
        runner.openSheet(A)
        runner.choose(REGENERATE)
        runner.choose(REGENERATE)
        advanceUntilIdle()
        assertTrue(sheet()!!.regenerating)

        runner.closeSheet()
        runner.openSheet(B)
        assertFalse(sheet()!!.regenerating)
        runner.openSheet(A)
        assertTrue(sheet()!!.regenerating)
        runner.openSheet(B)

        answer.complete(UPDATED)
        advanceUntilIdle()
        assertEquals(ArticleSheet(B), sheet())
        assertEquals(1, refreshes)
        assertEquals(listOf<ArticleActionEvent>(ArticleActionEvent.Say("Article details updated")), events)
    }

    @Test
    fun aRegenerateThatFails_staysInItsSheet_andOutsideItIsAMessage() = test {
        refresh = { DetailsRefresh.Failed }
        runner.openSheet(A)
        runner.choose(REGENERATE)
        advanceUntilIdle()
        assertEquals(ArticleSheet(A, failure = ErrorMessage.DETAILS_NOT_UPDATED.text), sheet())
        assertEquals(emptyList<ArticleActionEvent>(), events)

        runner.closeSheet()
        runner.run(REGENERATE, A)
        advanceUntilIdle()
        failures().single().retry!!.invoke()
        advanceUntilIdle()
        assertEquals(3, refreshes)

        listOf(
            DetailsRefresh.Missing to ErrorMessage.ARTICLE_MISSING,
            DetailsRefresh.NoLink to ErrorMessage.ARTICLE_HAS_NO_LINK,
        ).forEach { (answer, message) ->
            refresh = { answer }
            runner.run(REGENERATE, A)
            advanceUntilIdle()
            assertEquals(ArticleActionEvent.Failed(message), events.last())
        }
        assertEquals(emptyList<String>(), details)
    }

    @Test
    fun aPageThatCannotBeRead_writesNothing() = test {
        val unfurler = mockk<Unfurler>()
        coEvery { repository.getArticleById("a") } returns Article(itemId = "a", url = A.url)
        coEvery { unfurler.unfurl(any<String>()) } returns null
        assertEquals(DetailsRefresh.Failed, refreshArticleDetails(repository, unfurler, "a"))

        coEvery { unfurler.unfurl(any<String>()) } throws IllegalStateException("raw")
        assertEquals(DetailsRefresh.Failed, refreshArticleDetails(repository, unfurler, "a"))

        coVerify(exactly = 0) { repository.updateUnfurledDetails(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun anAnswerForA_neverTouchesTheSheetOfB() = test {
        val answer = CompletableDeferred<Unit>()
        coEvery { repository.setFavorite("a", true) } coAnswers { answer.await() }
        runner.openSheet(A)
        runner.choose(FAVOURITE)
        runner.openSheet(B)

        answer.complete(Unit)
        advanceUntilIdle()
        assertEquals(ArticleSheet(B), sheet())

        coEvery { repository.setReadStatus("a", true) } throws IllegalStateException("raw")
        runner.openSheet(A)
        runner.choose(READ)
        runner.openSheet(B)
        advanceUntilIdle()
        assertEquals(ArticleSheet(B), sheet())
        assertEquals(1, failures().size)
    }

    @Test
    fun cancellation_isNotToldAsAFailure() = test {
        coEvery { repository.setFavorite("a", true) } coAnswers { CompletableDeferred<Unit>().await() }
        refresh = { CompletableDeferred<DetailsRefresh>().await() }
        runner.openSheet(A)
        runner.choose(FAVOURITE)
        runner.choose(REGENERATE)
        advanceUntilIdle()

        scope.cancel()
        advanceUntilIdle()
        assertEquals(emptyList<ArticleActionEvent>(), events)
        assertNull(sheet()?.failure)
    }

    private companion object {
        val A = ArticleItem(itemId = "a", title = "A river", url = "https://example.com/a")
        val B = ArticleItem(itemId = "b", title = "B river", url = "https://example.com/b")
        val UPDATED = DetailsRefresh.Updated("A river", "https://example.com/a", null)
    }
}
