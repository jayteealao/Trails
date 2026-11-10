@file:OptIn(ExperimentalCoroutinesApi::class)

package com.jayteealao.trails.data

import android.content.Context
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import com.jayteealao.trails.services.firestore.FirestoreSyncManager
import io.mockk.MockKAnnotations
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The stored article text follows the rank of its source: a better-ranked archive replaces
 * a weaker stored text, a weaker or equal one does not, and a text whose source is not a
 * ranked archive is kept.
 */
class ArticleTextRankingTest {

    @MockK private lateinit var context: Context
    @MockK private lateinit var articleDao: ArticleDao
    @MockK private lateinit var firestoreSyncManager: FirestoreSyncManager

    private lateinit var repository: ArticleRepositoryImpl

    /** The one article row the fake DAO holds; null when the article does not exist. */
    private var row: Article? = null

    /** Extra time the fake DAO takes to write a text of the given source. */
    private val writeDelay = mutableMapOf<String, Long>()

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)
        coEvery { articleDao.getArticleById(ID) } coAnswers {
            delay(10)
            row
        }
        coEvery { articleDao.updateTextWithSource(ID, any(), any()) } coAnswers {
            val text = secondArg<String?>()
            val source = thirdArg<String>()
            delay(writeDelay[source] ?: 0)
            row = row?.copy(textSource = source)?.also { it.text = text }
        }
        repository = ArticleRepositoryImpl(
            context = context,
            articleDao = articleDao,
            firestoreSyncManager = firestoreSyncManager,
            coroutineScope = CoroutineScope(SupervisorJob() + StandardTestDispatcher()),
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    private fun stored(text: String?, source: String) {
        row = Article(itemId = ID, url = "https://example.com/a", textSource = source).also { it.text = text }
    }

    // ----- Readability stays when AI Markdown or renderer Markdown arrives (D-001) -----

    @Test
    fun storedReadability_aiMarkdownArrives_isKept() = runTest {
        stored("readability text", "readability")

        assertFalse(repository.offerArticleText(ID, "ai markdown text", "ai_markdown"))

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    @Test
    fun storedReadability_markdownArrives_isKept() = runTest {
        stored("readability text", "readability")

        assertFalse(repository.offerArticleText(ID, "markdown text", "markdown"))

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    // ----- A better source replaces a weaker stored text (AC-4) -----

    @Test
    fun storedMarkdown_readabilityArrives_isReplaced() = runTest {
        stored("markdown text", "markdown")

        assertTrue(repository.offerArticleText(ID, "readability text", "readability"))

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    // ----- Ranking wins over a manual pick (D-003) -----

    @Test
    fun manualPickOfMarkdown_thenReadabilityArrives_isReplaced() = runTest {
        stored(null, "")
        // The person picks the Markdown tab while no text is stored: the pick is offered.
        assertTrue(repository.offerArticleText(ID, "markdown text", "markdown"))
        assertEquals("markdown", row?.textSource)

        assertTrue(repository.offerArticleText(ID, "readability text", "readability"))

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    @Test
    fun storedReadability_manualPickOfMarkdown_isKept() = runTest {
        stored("readability text", "readability")

        assertFalse(repository.offerArticleText(ID, "markdown text", "markdown"))

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    // ----- A text from outside the rank is kept (RIM-1) -----

    @Test
    fun storedTextFromUnrankedSource_isNeverWritten() = runTest {
        stored("my own words", "user")

        assertFalse(repository.offerArticleText(ID, "readability text", "readability"))

        assertEquals("my own words", row?.text)
        coVerify(exactly = 0) { articleDao.updateTextWithSource(any(), any(), any()) }
    }

    @Test
    fun missingArticle_writesNothing() = runTest {
        row = null

        assertFalse(repository.offerArticleText(ID, "readability text", "readability"))

        assertNull(row)
        coVerify(exactly = 0) { articleDao.updateTextWithSource(any(), any(), any()) }
    }

    // ----- Two offers at once: the better one stays -----

    @Test
    fun concurrentOffers_leaveTheBetterText() = runTest {
        stored(null, "")
        // The Markdown write is slow, so without one lock the late Markdown write would land last.
        writeDelay["markdown"] = 50

        val markdown = launch { repository.offerArticleText(ID, "markdown text", "markdown") }
        val readability = launch { repository.offerArticleText(ID, "readability text", "readability") }
        advanceUntilIdle()
        markdown.join()
        readability.join()

        assertEquals("readability text", row?.text)
        assertEquals("readability", row?.textSource)
    }

    private companion object {
        const val ID = "a1"
    }
}
