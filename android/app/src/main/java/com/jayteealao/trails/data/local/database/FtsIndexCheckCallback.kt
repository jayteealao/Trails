package com.jayteealao.trails.data.local.database

import androidx.room3.RoomDatabase
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import kotlinx.coroutines.CancellationException
import timber.log.Timber

/**
 * At every open, checks that the search index holds one row per article and rebuilds it
 * from `article` when it does not (a missed backfill, or a rowid change the content
 * triggers did not see).
 *
 * The indexed count comes from FTS5's `article_fts_docsize` shadow table: `COUNT(*)` on an
 * external-content FTS5 table reads the content table, so it could never differ. A failure
 * here is logged and swallowed, so a broken index costs search, not the whole database.
 * A later change that runs `VACUUM` (which may renumber `article`'s rowids with equal
 * counts) must also rebuild the index.
 */
class FtsIndexCheckCallback : RoomDatabase.Callback() {
    override suspend fun onOpen(connection: SQLiteConnection) {
        super.onOpen(connection)
        try {
            val (indexed, articles) = connection.prepare(
                "SELECT (SELECT COUNT(*) FROM article_fts_docsize), (SELECT COUNT(*) FROM article)"
            ).use {
                it.step()
                it.getLong(0) to it.getLong(1)
            }
            if (indexed != articles) {
                connection.execSQL("INSERT INTO article_fts(article_fts) VALUES ('rebuild')")
                Timber.w("Search index rebuilt: %d indexed rows, %d articles", indexed, articles)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Search index check failed")
        }
    }
}
