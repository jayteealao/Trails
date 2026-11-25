package com.jayteealao.trails.screens.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which web link shared text holds. */
class SharedLinkTest {

    private fun url(text: String?) = sharedLink(text, null)?.url

    @Test
    fun textWithoutAWebLink_hasNone() {
        listOf(
            null, "", "   ", "just words", "example.com/a", "ftp://example.com/a", "mailto:mara@example.com",
            "xhttp://example.com", "git+https://example.com/a", "http://", "https:// example", "content://http/1",
        ).forEach { assertNull("$it", sharedLink(it, "A title")) }
    }

    @Test
    fun theLinkIsFoundWhereverItStands() {
        assertEquals("https://example.com/a", url("https://example.com/a"))
        assertEquals("http://example.com/a?b=c#d", url("  http://example.com/a?b=c#d\n"))
        assertEquals("HTTPS://Example.com/A", url("HTTPS://Example.com/A"))
        assertEquals("https://example.com/a", url("Read https://example.com/a now"))
        assertEquals("https://example.com/a", url("看https://example.com/a。"))
        assertEquals("https://example.com/a", url("「https://example.com/a」を読む"))
        assertEquals("https://example.com/b", url("https:// then https://example.com/b"))
        assertEquals("https://example.com/a", url("https://example.com/a https://example.com/b"))
        assertEquals(
            "https://archive.example/web/https://example.com/a",
            url("https://archive.example/web/https://example.com/a"),
        )
    }

    @Test
    fun theSentenceAroundTheLinkIsNotPartOfIt() {
        assertEquals("https://example.com/a", url("See https://example.com/a."))
        assertEquals("https://example.com/a", url("Really (https://example.com/a)?!"))
        assertEquals("https://example.com/a", url("[https://example.com/a],"))
        assertEquals("https://example.com/a", url("<https://example.com/a>"))
        assertEquals("https://example.com/a", url("\"https://example.com/a\""))
        assertEquals("https://example.com/Foo_(bar)", url("https://example.com/Foo_(bar)"))
        assertEquals("https://example.com/Foo_(bar)", url("(https://example.com/Foo_(bar))."))
    }

    @Test
    fun theTitleIsTheGivenOne_elseTheWordsBeforeTheLink() {
        assertEquals("Given", sharedLink("Words https://example.com/a", " Given ")!!.title)
        assertEquals("Words", sharedLink("Words\n\nhttps://example.com/a after", "  ")!!.title)
        assertEquals("", sharedLink("https://example.com/a", null)!!.title)
    }

    @Test
    fun theAddressHasNoScheme_andTheHostIsWhole() {
        val link = sharedLink("https://news.example.co.uk/a?b=c", null)!!
        assertEquals("news.example.co.uk/a?b=c", link.address)
        assertEquals("news.example.co.uk", link.host)
    }
}
