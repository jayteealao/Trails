package com.jayteealao.trails.screens.articleDetail

import com.jayteealao.trails.screens.articleDetail.ReaderBody.Loading
import com.jayteealao.trails.screens.articleDetail.ReaderBody.Notice
import com.jayteealao.trails.screens.articleDetail.ReaderBody.Text
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.EMPTY
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.FAILED
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.NO_TEXT
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.OFFLINE
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.UNREADABLE
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeKind.WAITING
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What the Reader shows before or instead of text: the quiet notices, the skeleton, and the
 * words of each notice.
 */
class ReaderNoticesTest {

    /** An opened article with no text, online, with nothing pending. */
    private val base = ReaderSignals(hasText = false, loaded = true, online = true)

    private fun body(signals: ReaderSignals) = readerBodyFor(signals)

    // --- The Reader body ---

    @Test
    fun `a text archive downloading shows the waiting notice with skeleton lines`() {
        assertEquals(Notice(WAITING, skeleton = true), body(base.copy(textDownloading = true)))
    }

    @Test
    fun `a text archive downloading while offline shows the offline notice`() {
        assertEquals(Notice(OFFLINE), body(base.copy(textDownloading = true, online = false)))
    }

    @Test
    fun `offline with nothing known shows the offline notice`() {
        assertEquals(Notice(OFFLINE), body(base.copy(online = false)))
    }

    @Test
    fun `a failed or abandoned archive shows the failed notice, also offline`() {
        for (status in listOf("failed", "abandoned")) {
            assertEquals(Notice(FAILED), body(base.copy(articleStatus = status)))
            assertEquals(Notice(FAILED), body(base.copy(articleStatus = status, online = false)))
        }
    }

    @Test
    fun `a local text archive with blank text shows the no-text notice`() {
        assertEquals(Notice(NO_TEXT), body(base.copy(localTextArchive = true, localTextBlank = true)))
    }

    @Test
    fun `a complete or partial archive with no text pending shows the no-text notice, also offline`() {
        for (status in listOf("complete", "partial")) {
            assertEquals(Notice(NO_TEXT), body(base.copy(articleStatus = status)))
            assertEquals(Notice(NO_TEXT), body(base.copy(articleStatus = status, online = false)))
        }
    }

    @Test
    fun `a text archive on the server not yet on the phone shows the waiting notice alone, or offline`() {
        assertEquals(Notice(WAITING), body(base.copy(remoteTextPending = true)))
        assertEquals(Notice(OFFLINE), body(base.copy(remoteTextPending = true, online = false)))
    }

    @Test
    fun `local text archives none of which open show the could-not-open notice`() {
        assertEquals(Notice(UNREADABLE), body(base.copy(localTextArchive = true, localTextUnreadable = true)))
    }

    @Test
    fun `a failed text download shows the could-not-open notice, or offline`() {
        assertEquals(Notice(UNREADABLE), body(base.copy(textDownloadFailed = true)))
        assertEquals(Notice(OFFLINE), body(base.copy(textDownloadFailed = true, online = false)))
    }

    @Test
    fun `the first read of an open shows the skeleton`() {
        assertEquals(Loading, body(base.copy(loaded = false)))
    }

    @Test
    fun `text always shows, whatever else is set`() {
        val everything = ReaderSignals(
            hasText = true,
            loaded = false,
            online = false,
            textDownloading = true,
            textDownloadFailed = true,
            remoteTextPending = true,
            localTextArchive = true,
            localTextBlank = true,
            localTextUnreadable = true,
            articleStatus = "failed",
        )
        assertEquals(Text, body(everything))
    }

    @Test
    fun `a pending, processing or unknown status with nothing pending shows the waiting notice alone`() {
        for (status in listOf("pending", "processing", null)) {
            assertEquals(Notice(WAITING), body(base.copy(articleStatus = status)))
        }
    }

    // --- A text archive tab ---

    @Test
    fun `a text archive tab shows the skeleton, the could-not-open notice, the empty notice or the text`() {
        assertEquals(Loading, archiveTabBodyFor(null, loadFailed = false))
        assertEquals(Notice(UNREADABLE), archiveTabBodyFor(null, loadFailed = true))
        assertEquals(Notice(EMPTY), archiveTabBodyFor("  ", loadFailed = false))
        assertEquals(Text, archiveTabBodyFor("# A", loadFailed = false))
    }

    // --- The words ---

    @Test
    fun `each notice has its approved words`() {
        val words = mapOf(
            WAITING to ("The text is on its way" to
                "It arrives soon after you save an article. The Web tab works now."),
            OFFLINE to ("You’re offline" to
                "The text downloads when you’re back online. Articles you opened before still read offline."),
            NO_TEXT to ("No reader text for this article" to
                "The archive kept no text for this page. Read it on the Web tab."),
            FAILED to ("The archive failed" to
                "There is no reader text for this article. Read it on the Web tab."),
            EMPTY to ("This text is empty" to
                "The archive saved no words for this page. Read it on the Web tab."),
            UNREADABLE to ("The text could not be opened" to
                "The saved file did not open. Read the article on the Web tab."),
        )
        assertEquals(ReaderNoticeKind.entries.toSet(), words.keys)
        for ((kind, copy) in words) {
            assertEquals("title of $kind", copy.first, kind.title)
            assertEquals("line of $kind", copy.second, kind.line)
        }
    }

    @Test
    fun `every notice but offline names the Web tab`() {
        for (kind in ReaderNoticeKind.entries) {
            assertEquals("$kind names the Web tab", kind != OFFLINE, "Web tab" in kind.line)
        }
    }

    @Test
    fun `only the failed and could-not-open notices are in the error colour`() {
        for (kind in ReaderNoticeKind.entries) {
            assertEquals("$kind error colour", kind == FAILED || kind == UNREADABLE, kind.isError)
        }
    }

    @Test
    fun `no notice says No content`() {
        for (kind in ReaderNoticeKind.entries) {
            assertFalse(kind.title == "No content" || kind.line == "No content")
        }
    }

    // --- Source guards ---

    private val mainSource: File = listOf(File("src/main/java"), File("app/src/main/java"))
        .first { it.isDirectory }

    private fun source(relative: String): String =
        File(mainSource, "com/jayteealao/trails/screens/articleDetail/$relative").readText()

    @Test
    fun `the old placeholder words are gone from the app`() {
        val offenders = mainSource.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { file -> file.readText().let { "\"No content\"" in it || "\"Loading...\"" in it } }
            .map { it.relativeTo(mainSource).invariantSeparatorsPath }
            .toList()
        assertEquals(emptyList<String>(), offenders)
    }

    @Test
    fun `the notices draw no progress indicator`() {
        assertFalse("ProgressIndicator(" in source("ReaderNotices.kt"))
    }

    @Test
    fun `the article body draws no progress indicator`() {
        val screen = source("ArticleDetailScreen.kt")
        val details = screen.substringAfter("fun ArticleDetails(", missingDelimiterValue = "")
            .substringBefore("\n@")
        assertTrue("ArticleDetails is in ArticleDetailScreen.kt", details.isNotEmpty())
        assertFalse("ProgressIndicator(" in details)
        assertFalse("\"Loading...\"" in details)
    }
}
