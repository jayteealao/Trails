package com.jayteealao.trails.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import com.jayteealao.trails.data.archive.ArchiveType
import com.jayteealao.trails.data.archive.LocalArchive
import com.jayteealao.trails.data.archive.LocalArchiveDao
import com.jayteealao.trails.data.local.LocalFolders
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.local.database.ArticleDao
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream

/**
 * Debug only: makes a better text source arrive while the Reader is open, for device checks.
 *
 * [ACTION_SEED] stores the article [ITEM_ID] with renderer Markdown text and its local
 * Markdown archive. [ACTION_ARRIVE] then stores a local Readability archive, as a download
 * would, so the open Reader receives a better-ranked source. With [EXTRA_ITEM_ID] (it must start
 * with [TEXT_FIRST_PREFIX]) it stores that archive for an article seeded by [ACTION_SEED_EMPTY]
 * instead, so the first text arrives while the Reader shows its waiting notice.
 *
 * [ACTION_SEED_EMPTY] stores an article with no text and no local archive under the id in
 * [EXTRA_ITEM_ID] (it must start with [TEXT_FIRST_PREFIX]), so its archives arrive by download
 * from the local stub, for the check that a large archive does not hold back the text.
 *
 * [ACTION_SEED_ALL_ARCHIVES] stores the article [ALL_ARCHIVES_ITEM_ID] with Readability text and
 * all six local archives, so the detail screen shows every tab. Its AI Markdown archive holds a
 * byline, a figure (a PNG this receiver writes to the app's files) and its caption.
 *
 * [ACTION_SEED_WORST] stores the article [WORST_ITEM_ID] with the worst text the reading column
 * must hold: a five-line title, a broken image, a long unbroken URL and a body of at least
 * [WORST_WORD_TARGET] words, as its Reader text and as its AI Markdown archive.
 */
class ReaderFixtureReceiver : BroadcastReceiver() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface ReaderFixtureEntryPoint {
        fun articleDao(): ArticleDao
        fun localArchiveDao(): LocalArchiveDao
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in setOf(ACTION_SEED, ACTION_ARRIVE, ACTION_SEED_EMPTY, ACTION_SEED_ALL_ARCHIVES, ACTION_SEED_WORST)) return
        val emptyId = intent.getStringExtra(EXTRA_ITEM_ID)
        if (action == ACTION_SEED_EMPTY && emptyId?.startsWith(TEXT_FIRST_PREFIX) != true) {
            Timber.w("ReaderFixtureReceiver — $action needs an $EXTRA_ITEM_ID that starts with $TEXT_FIRST_PREFIX, got $emptyId")
            return
        }
        if (action == ACTION_ARRIVE && emptyId != null && !emptyId.startsWith(TEXT_FIRST_PREFIX)) {
            Timber.w("ReaderFixtureReceiver — $action takes an $EXTRA_ITEM_ID that starts with $TEXT_FIRST_PREFIX, got $emptyId")
            return
        }
        val app = context.applicationContext
        val entryPoint = EntryPointAccessors.fromApplication(app, ReaderFixtureEntryPoint::class.java)
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (action) {
                    ACTION_SEED -> seed(app, entryPoint)
                    ACTION_SEED_EMPTY -> seedEmpty(entryPoint.articleDao(), emptyId!!)
                    ACTION_SEED_ALL_ARCHIVES -> seedAllArchives(app, entryPoint)
                    ACTION_SEED_WORST -> seedWorst(app, entryPoint)
                    else -> storeArchive(
                        app, entryPoint.localArchiveDao(), emptyId ?: ITEM_ID, ArchiveType.READABILITY, READABILITY_SAMPLE,
                    )
                }
                Timber.d("ReaderFixtureReceiver — $action done")
            } catch (e: Exception) {
                Timber.e(e, "ReaderFixtureReceiver — $action failed")
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun seed(app: Context, entryPoint: ReaderFixtureEntryPoint) {
        // A second seed starts over: drop the Readability file an earlier arrival stored.
        archiveFile(app, ITEM_ID, ArchiveType.READABILITY).delete()
        val now = System.currentTimeMillis()
        entryPoint.articleDao().upsertArticle(
            Article(
                itemId = ITEM_ID,
                title = TITLE,
                givenTitle = TITLE,
                url = URL,
                givenUrl = URL,
                timeAdded = now,
                timeUpdated = now,
                text = MARKDOWN_SAMPLE,
                textSource = ArchiveType.MARKDOWN.archiveKey,
            )
        )
        storeArchive(app, entryPoint.localArchiveDao(), ITEM_ID, ArchiveType.MARKDOWN, MARKDOWN_SAMPLE)
    }

    private suspend fun seedAllArchives(app: Context, entryPoint: ReaderFixtureEntryPoint) {
        val now = System.currentTimeMillis()
        entryPoint.articleDao().upsertArticle(
            Article(
                itemId = ALL_ARCHIVES_ITEM_ID,
                title = TITLE,
                givenTitle = TITLE,
                url = ALL_ARCHIVES_URL,
                givenUrl = ALL_ARCHIVES_URL,
                timeAdded = now,
                timeUpdated = now,
                text = READABILITY_SAMPLE,
                textSource = ArchiveType.READABILITY.archiveKey,
            )
        )
        val samples = mapOf(
            ArchiveType.READABILITY to READABILITY_SAMPLE,
            ArchiveType.MARKDOWN to MARKDOWN_SAMPLE,
            ArchiveType.AI_MARKDOWN to aiMarkdownSample(figureUri(app)),
            ArchiveType.SINGLEFILE to htmlSample("SingleFile"),
            ArchiveType.MONOLITH to htmlSample("Monolith"),
            ArchiveType.RENDERED to htmlSample("Rendered"),
        )
        samples.forEach { (type, text) ->
            storeArchive(app, entryPoint.localArchiveDao(), ALL_ARCHIVES_ITEM_ID, type, text)
        }
    }

    private suspend fun seedWorst(app: Context, entryPoint: ReaderFixtureEntryPoint) {
        val now = System.currentTimeMillis()
        val text = worstMarkdown()
        entryPoint.articleDao().upsertArticle(
            Article(
                itemId = WORST_ITEM_ID,
                title = WORST_TITLE,
                givenTitle = WORST_TITLE,
                url = WORST_URL,
                givenUrl = WORST_URL,
                timeAdded = now,
                timeUpdated = now,
                text = text,
                textSource = ArchiveType.AI_MARKDOWN.archiveKey,
            )
        )
        storeArchive(app, entryPoint.localArchiveDao(), WORST_ITEM_ID, ArchiveType.AI_MARKDOWN, text)
    }

    /** Writes the figure of the AI Markdown sample once, a 1600 x 900 PNG, and returns its file URI. */
    private fun figureUri(app: Context): String {
        val file = File(app.filesDir, "reader-fixture/figure.png")
        if (!file.exists()) {
            file.parentFile?.mkdirs()
            val bitmap = Bitmap.createBitmap(1600, 900, Bitmap.Config.ARGB_8888)
            Canvas(bitmap).apply {
                drawColor(0xFFDCE8F4.toInt())
                drawRect(0f, 560f, 1600f, 760f, Paint().apply { color = 0xFF8FB0D0.toInt() })
            }
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        return Uri.fromFile(file).toString()
    }

    private suspend fun seedEmpty(articleDao: ArticleDao, itemId: String) {
        val now = System.currentTimeMillis()
        val url = "https://example.com/$itemId"
        articleDao.upsertArticle(
            Article(
                itemId = itemId,
                title = TEXT_FIRST_TITLE,
                givenTitle = TEXT_FIRST_TITLE,
                url = url,
                givenUrl = url,
                timeAdded = now,
                timeUpdated = now,
            )
        )
    }

    private fun archiveFile(app: Context, itemId: String, type: ArchiveType): File =
        File(app.filesDir, "${LocalFolders.ARCHIVES_DIR}/$itemId/${type.localFilename}")

    private suspend fun storeArchive(app: Context, dao: LocalArchiveDao, itemId: String, type: ArchiveType, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val gzipped = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()
        val file = archiveFile(app, itemId, type)
        file.parentFile?.mkdirs()
        file.writeBytes(gzipped)
        dao.upsert(
            LocalArchive(
                itemId = itemId,
                archiveKey = type.archiveKey,
                localPath = "${LocalFolders.ARCHIVES_DIR}/$itemId/${type.localFilename}",
                compressedSizeBytes = gzipped.size.toLong(),
                originalSizeBytes = bytes.size.toLong(),
                downloadedAt = System.currentTimeMillis(),
            )
        )
    }

    companion object {
        const val ACTION_SEED = "com.jayteealao.trails.debug.READER_SEED"
        const val ACTION_ARRIVE = "com.jayteealao.trails.debug.READER_ARRIVE"
        const val ACTION_SEED_EMPTY = "com.jayteealao.trails.debug.READER_SEED_EMPTY"
        const val ACTION_SEED_ALL_ARCHIVES = "com.jayteealao.trails.debug.READER_SEED_ALL_ARCHIVES"
        const val ACTION_SEED_WORST = "com.jayteealao.trails.debug.READER_SEED_WORST"
        const val EXTRA_ITEM_ID = "itemId"
        const val TEXT_FIRST_PREFIX = "text-first"
        private const val TEXT_FIRST_TITLE = "A text that arrives first"
        const val ITEM_ID = "reader-fixture"
        private const val TITLE = "Counting the street trees of a small city"
        private const val URL = "https://example.com/street-trees"
        const val ALL_ARCHIVES_ITEM_ID = "reader-all-archives"
        private const val ALL_ARCHIVES_URL = "https://example.com/street-trees-all"
        const val WORST_ITEM_ID = "reader-worst"
        private const val WORST_URL = "https://example.com/street-trees-worst"
        private const val WORST_TITLE = "Counting every street tree of a small river city, block by block, " +
            "over three wet summers, with volunteers, paper maps and one borrowed tape measure"

        /** The least number of words in the body of the worst article. */
        const val WORST_WORD_TARGET = 20_000

        // Synthetic sample texts, written for this check; not from a real site.

        /** The renderer's Markdown: the whole page, with the site menu line. */
        private val MARKDOWN_SAMPLE = """
            Home | News | Projects | About | Subscribe

            # Counting the street trees of a small city

            Every spring a group of volunteers walks each street of the town with a clipboard and a tape measure.

            They note the kind of each tree, the width of its trunk and whether it looks healthy.

            Share this article: Facebook | Email | Print
        """.trimIndent()

        /** Readability: a title, a byline, a published line, then plain paragraphs. */
        private val READABILITY_SAMPLE = """
            # Counting the street trees of a small city

            By Mara Ellison

            Published: 2026-10-30T08:00:00Z

            Every spring a group of volunteers walks each street of the town with a clipboard and a tape measure.

            They note the kind of each tree, the width of its trunk and whether it looks healthy.

            Last year they counted 4,120 trees, about one for every three people who live here.
        """.trimIndent()

        /** AI Markdown: structured text with a byline, headings, a figure, a list and an absolute link. */
        private fun aiMarkdownSample(figureUri: String) = """
            # Counting the street trees of a small city

            *By Mara Ellison*

            Every spring a group of volunteers walks each street of the town with a clipboard and a tape measure.

            ## How the count works

            ![A volunteer measures the trunk of a lime tree]($figureUri)

            *A volunteer measures a lime on Mill Street.*

            - The kind of each tree
            - The width of its trunk at chest height
            - Whether it looks healthy

            ## What the trees showed

            By the end of the first summer they had 6,400 trees on paper. Lime and plane made up more than half.

            ### Planting from the survey

            The council now plants 300 trees a year, chosen from the survey. The spreadsheet is on the [council's open data page](https://data.example.org/street-trees).
        """.trimIndent()

        private const val WORST_SECTION_TEXT =
            "By the end of the first summer they had 6,400 trees on paper. Lime and plane made up more than " +
                "half. On the newer estates, cherry and rowan took over, planted in the seventies and now " +
                "reaching the end of their lives.\n\n" +
                "The data showed a pattern the walkers had felt on foot: the older centre kept its canopy, while " +
                "the ring road and the estates beyond it had lost one tree in five since the last count."

        /**
         * The worst text: the long title, a broken image (its host is reserved never to resolve), a
         * long unbroken URL, then repeated sections until the body holds [WORST_WORD_TARGET] words.
         */
        private fun worstMarkdown(): String = buildString {
            append(
                """
                # $WORST_TITLE

                *By Mara Ellison*

                The survey began with a question nobody at the council could answer: how many trees line our streets? The last count was a typed list from 1987, and half of the streets on it had new names.

                ## How the count worked

                Forty volunteers split the city into 212 blocks. Each pair walked one block an evening, measured the trunk of every tree at chest height and noted the species, the state of the bark and the width of the verge.

                ![A map of the 212 survey blocks](https://images.example.invalid/street-trees/survey-blocks-map.png)

                - 212 blocks, two walkers each
                - Trunk girth at chest height
                - Species, bark state and verge width

                ### Planting from the survey

                The council now plants 300 trees a year, chosen from the survey. Source list: [https://data.example.org/datasets/street-trees/2026/survey-export-final-v3-complete-with-girth-species-and-verge-columns.csv](https://data.example.org/datasets/street-trees/2026/survey-export-final-v3-complete-with-girth-species-and-verge-columns.csv)
                """.trimIndent()
            )
            val sectionWords = WORST_SECTION_TEXT.split(Regex("\\s+")).size + 3
            var words = toString().split(Regex("\\s+")).size
            var section = 1
            while (words < WORST_WORD_TARGET) {
                append("\n\n## Section ").append(section++).append("\n\n").append(WORST_SECTION_TEXT)
                words += sectionWords
            }
        }

        /** A small HTML page standing in for one of the HTML archives. */
        private fun htmlSample(kind: String) =
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>$TITLE</title></head>" +
                "<body><h1>$TITLE</h1><p>$kind archive sample: every spring a group of volunteers " +
                "walks each street of the town with a clipboard and a tape measure.</p></body></html>"
    }
}
