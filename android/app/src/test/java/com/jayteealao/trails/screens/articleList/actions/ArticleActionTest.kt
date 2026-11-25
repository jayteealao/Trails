package com.jayteealao.trails.screens.articleList.actions

import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.COPY_LINK
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.DELETE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.OPEN
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.REGENERATE
import com.jayteealao.trails.screens.articleList.actions.ArticleAction.SHARE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The order, the words and the rules of the actions of an article. */
class ArticleActionTest {

    private val article = ArticleItem(itemId = "a", title = "A river", url = "https://rivers.example.org/a")

    private fun labels(article: ArticleItem, regenerating: Boolean = false) =
        articleActions(article, regenerating).map { it.label }

    private fun disabled(article: ArticleItem, regenerating: Boolean = false) =
        articleActions(article, regenerating).filterNot { it.enabled }.map { it.action }

    @Test
    fun theEightActions_areInTheOrderOfTheSheet() {
        assertEquals(
            listOf(
                "Add to favourites", "Mark as read", "Archive", "Open in browser", "Share", "Copy link",
                "Regenerate details", "Delete",
            ),
            labels(article),
        )
        assertEquals(ArticleAction.entries.toList(), articleActions(article).map { it.action })
        assertEquals(emptyList<ArticleAction>(), disabled(article))
    }

    @Test
    fun aFavouriteThatWasRead_offersTheOpposite() {
        assertEquals(
            listOf("Remove from favourites", "Mark as unread"),
            labels(article.copy(favorite = true, isRead = true)).take(2),
        )
    }

    @Test
    fun anAddressNoBrowserOpens_disablesOpenShareAndCopyOnly() {
        listOf("", "   ", "not a link", "mailto:someone", "file:///a.html").forEach { url ->
            assertEquals(url, listOf(OPEN, SHARE, COPY_LINK), disabled(article.copy(url = url)))
            assertNull(url, article.copy(url = url).webHost)
        }
        assertEquals("rivers.example.org", article.webHost)
    }

    @Test
    fun whileTheDetailsLoad_onlyRegenerateIsDisabled() {
        assertEquals(listOf(REGENERATE), disabled(article, regenerating = true))
        assertEquals("Regenerating details…", labels(article, regenerating = true)[REGENERATE.ordinal])
    }

    @Test
    fun onlyDeleteIsDrawnAsAnError() {
        assertEquals(listOf(DELETE), articleActions(article).filter { it.isError }.map { it.action })
    }
}
