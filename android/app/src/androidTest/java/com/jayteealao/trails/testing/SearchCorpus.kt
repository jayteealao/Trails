package com.jayteealao.trails.testing

import com.jayteealao.trails.data.local.database.Article
import kotlin.random.Random

/**
 * A deterministic library of [ROWS] articles for the search benchmarks.
 *
 * Titles have 6–10 words and texts 500 words, drawn from a fixed vocabulary of
 * [VOCABULARY_SIZE] made-up words. Every article has `timeAdded` and `timeUpdated`; 5% are
 * deleted and 10% archived. Three real words are planted: [HARBOR] in 5% of the articles,
 * [LANTERN] in 2% and [MERIDIAN] in 40% (far more matches than one result page holds).
 * The same seed gives the same library on the host and on a device.
 *
 * The androidTest source set keeps an identical copy of this file.
 */
object SearchCorpus {
    const val ROWS = 5_000
    const val VOCABULARY_SIZE = 2_000
    const val TEXT_WORDS = 500
    const val HARBOR = "harbor"
    const val LANTERN = "lantern"
    const val MERIDIAN = "meridian"

    /** The inputs a person types, as the benchmarks time them. */
    val INPUTS = listOf("$HARBOR $LANTERN", MERIDIAN, HARBOR)

    private val planted = setOf(HARBOR, LANTERN, MERIDIAN)

    /** Made-up words of two to four syllables; none is a real word the corpus plants. */
    val vocabulary: List<String> by lazy {
        val random = Random(7)
        val consonants = "bdfgklmnprstvz"
        val vowels = "aeiou"
        val words = LinkedHashSet<String>()
        while (words.size < VOCABULARY_SIZE) {
            val word = buildString {
                repeat(2 + random.nextInt(3)) {
                    append(consonants[random.nextInt(consonants.length)])
                    append(vowels[random.nextInt(vowels.length)])
                }
            }
            if (word !in planted) words += word
        }
        words.toList()
    }

    fun articles(rows: Int = ROWS): List<Article> {
        val random = Random(42)
        val words = vocabulary
        fun phrase(count: Int) = List(count) { words[random.nextInt(words.size)] }
        return (1..rows).map { n ->
            val title = phrase(6 + random.nextInt(5)).toMutableList()
            val text = phrase(TEXT_WORDS).toMutableList()
            if (random.nextInt(100) < 5) text[random.nextInt(text.size)] = HARBOR
            if (random.nextInt(100) < 2) title[random.nextInt(title.size)] = LANTERN
            if (random.nextInt(100) < 40) text[random.nextInt(text.size)] = MERIDIAN
            val time = 1_600_000_000_000L + n * 60_000L
            Article(
                itemId = "s$n",
                title = title.joinToString(" ").replaceFirstChar { it.uppercase() },
                url = "https://example.com/search/$n",
                text = text.joinToString(" "),
                timeAdded = time,
                timeUpdated = time,
                deletedAt = if (random.nextInt(100) < 5) time + 1 else null,
                archivedAt = if (random.nextInt(100) < 10) time + 2 else null,
            )
        }
    }
}
