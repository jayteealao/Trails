package com.jayteealao.trails.data.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * The match string built from what the person types: every word and every quoted phrase is
 * one quoted FTS5 string, joined by OR, so no typed character reaches the FTS5 query parser
 * as an operator.
 */
class FtsMatchQueryTest {

    @Test
    fun twoWords_matchEitherWord() {
        assertEquals("\"river\" OR \"mill\"", FtsMatchQuery.build("river mill"))
    }

    @Test
    fun quotedPhrase_staysOnePhrase() {
        assertEquals("\"old mill\"", FtsMatchQuery.build("\"old mill\""))
        assertEquals("\"old mill\" OR \"river\"", FtsMatchQuery.build("\"old mill\" river"))
    }

    @Test
    fun operatorWordsAndSymbols_areQuotedAsLiteralWords() {
        val expected = mapOf(
            "\"" to "\"\"\"\"",
            "*" to "\"*\"",
            "-" to "\"-\"",
            "NEAR" to "\"NEAR\"",
            "AND" to "\"AND\"",
            "OR" to "\"OR\"",
            "a\"b" to "\"a\"\"b\"",
        )
        for ((input, match) in expected) assertEquals("input $input", match, FtsMatchQuery.build(input))
    }

    @Test
    fun emptyOrBlankInput_buildsNoQuery() {
        assertNull(FtsMatchQuery.build(""))
        assertNull(FtsMatchQuery.build("   \t "))
        assertNull(FtsMatchQuery.build("\"\""))
    }

    @Test
    fun unclosedQuote_isALiteralCharacter() {
        assertEquals("\"\"\"old\" OR \"mill\"", FtsMatchQuery.build("\"old mill"))
    }

    @Test
    fun tabsAndRepeatedSpaces_separateWords() {
        assertEquals("\"river\" OR \"mill\" OR \"road\"", FtsMatchQuery.build("  river\t\tmill    road "))
    }

    @Test
    fun accentedWord_passesThroughUnchanged() {
        assertEquals("\"café\"", FtsMatchQuery.build("café"))
    }

    @Test
    fun randomInput_alwaysBuildsWellFormedStrings() {
        val random = Random(2026)
        val alphabet = "\"*-()^:+ ab"
        val wellFormed = Regex("\"(?:[^\"]|\"\")*\"(?: OR \"(?:[^\"]|\"\")*\")*")
        repeat(200) {
            val input = String(CharArray(1 + random.nextInt(12)) { alphabet[random.nextInt(alphabet.length)] })
            val match = FtsMatchQuery.build(input) ?: return@repeat
            assertEquals("even quote count for <$input>: $match", 0, match.count { it == '"' } % 2)
            assertTrue("well-formed for <$input>: $match", wellFormed.matches(match))
        }
    }
}
