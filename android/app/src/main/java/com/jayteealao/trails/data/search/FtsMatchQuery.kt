package com.jayteealao.trails.data.search

/**
 * Builds the FTS5 `MATCH` string from what the person typed.
 *
 * Every word and every quoted phrase becomes one quoted FTS5 string (an inner `"` is doubled),
 * and the strings are joined with ` OR `, so an article matches any of them. A `"` at the start
 * of a word opens a phrase when a later `"` closes it; any other `"` is a literal character.
 * Because every term is a quoted string, no operator, column filter, prefix star or parenthesis
 * from the input reaches the FTS5 parser, and no term is left unterminated.
 */
object FtsMatchQuery {

    /** The match string, or null when the input holds no word or phrase. */
    fun build(input: String): String? {
        val terms = mutableListOf<String>()
        var i = 0
        while (i < input.length) {
            val c = input[i]
            if (c.isWhitespace()) {
                i++
                continue
            }
            val close = if (c == '"') input.indexOf('"', i + 1) else -1
            if (close > 0) {
                val phrase = input.substring(i + 1, close)
                if (phrase.isNotBlank()) terms += quote(phrase)
                i = close + 1
            } else {
                var end = i
                while (end < input.length && !input[end].isWhitespace()) end++
                terms += quote(input.substring(i, end))
                i = end
            }
        }
        return terms.takeIf { it.isNotEmpty() }?.joinToString(" OR ")
    }

    internal fun quote(term: String) = "\"" + term.replace("\"", "\"\"") + "\""
}
