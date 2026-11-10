package com.jayteealao.trails.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
 * would, so the open Reader receives a better-ranked source.
 *
 * [ACTION_SEED_EMPTY] stores an article with no text and no local archive under the id in
 * [EXTRA_ITEM_ID] (it must start with [TEXT_FIRST_PREFIX]), so its archives arrive by download
 * from the local stub, for the check that a large archive does not hold back the text.
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
        if (action != ACTION_SEED && action != ACTION_ARRIVE && action != ACTION_SEED_EMPTY) return
        val emptyId = intent.getStringExtra(EXTRA_ITEM_ID)
        if (action == ACTION_SEED_EMPTY && emptyId?.startsWith(TEXT_FIRST_PREFIX) != true) {
            Timber.w("ReaderFixtureReceiver — $action needs an $EXTRA_ITEM_ID that starts with $TEXT_FIRST_PREFIX, got $emptyId")
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
                    else -> storeArchive(app, entryPoint.localArchiveDao(), ArchiveType.READABILITY, READABILITY_SAMPLE)
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
        archiveFile(app, ArchiveType.READABILITY).delete()
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
        storeArchive(app, entryPoint.localArchiveDao(), ArchiveType.MARKDOWN, MARKDOWN_SAMPLE)
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

    private fun archiveFile(app: Context, type: ArchiveType): File =
        File(app.filesDir, "${LocalFolders.ARCHIVES_DIR}/$ITEM_ID/${type.localFilename}")

    private suspend fun storeArchive(app: Context, dao: LocalArchiveDao, type: ArchiveType, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val gzipped = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()
        val file = archiveFile(app, type)
        file.parentFile?.mkdirs()
        file.writeBytes(gzipped)
        dao.upsert(
            LocalArchive(
                itemId = ITEM_ID,
                archiveKey = type.archiveKey,
                localPath = "${LocalFolders.ARCHIVES_DIR}/$ITEM_ID/${type.localFilename}",
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
        const val EXTRA_ITEM_ID = "itemId"
        const val TEXT_FIRST_PREFIX = "text-first"
        private const val TEXT_FIRST_TITLE = "A text that arrives first"
        const val ITEM_ID = "reader-fixture"
        private const val TITLE = "Counting the street trees of a small city"
        private const val URL = "https://example.com/street-trees"

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
    }
}
