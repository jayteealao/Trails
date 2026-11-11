package com.jayteealao.trails.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * A checked fact about the app source: the person cannot edit the text of an article.
 *
 * The stored article text is written only by the ranked write of the repository, which the
 * article detail screen calls with archive texts, and the only text field in the app is the
 * tag field. So replacing a weaker stored text with a better-ranked archive never loses an
 * edit. The ranked write also keeps any stored text whose source is not a ranked archive
 * (see `TextSourceRank.shouldReplace`), so an edit saved under its own source is kept.
 *
 * When an editor for the article text is added, update this test, and check that the editor
 * stores its text under a source that `TextSourceRank` does not rank.
 */
class ArticleTextWritersTest {

    private val mainSource: File = listOf(File("src/main/java"), File("app/src/main/java"))
        .first { it.isDirectory }

    private fun filesCalling(pattern: Regex): Set<String> =
        mainSource.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { pattern.containsMatchIn(it.readText()) }
            .map { it.relativeTo(mainSource).invariantSeparatorsPath }
            .toSet()

    @Test
    fun storedTextIsWrittenOnlyByTheRankedWrite() {
        assertEquals(
            setOf(
                "com/jayteealao/trails/data/local/database/ArticleDao.kt",
                "com/jayteealao/trails/data/ArticleRepository.kt",
            ),
            filesCalling(Regex("""\bupdateTextWithSource\(""")),
        )
    }

    @Test
    fun rankedWriteIsCalledOnlyByTheArticleDetailScreen() {
        assertEquals(
            setOf(
                "com/jayteealao/trails/data/ArticleRepository.kt",
                "com/jayteealao/trails/screens/articleDetail/ArticleDetailViewModel.kt",
            ),
            filesCalling(Regex("""\bofferArticleText\(""")),
        )
    }

    @Test
    fun noTextFieldOutsideTheTagScreen() {
        assertEquals(
            emptySet<String>(),
            filesCalling(Regex("""\b(?:Outlined|Basic)?TextField\("""))
                .filterNot { it.startsWith("com/jayteealao/trails/screens/tagManagement/") }
                .toSet(),
        )
    }
}
