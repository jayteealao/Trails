package com.jayteealao.trails.data.local.database

import android.app.Application
import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import com.jayteealao.trails.common.normalizeUrl
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Proves that the app database registers the URL backfill callback and that it runs on open.
 *
 * The database is built through [configureAppDatabase], the same function the app's database
 * module uses, so the first test fails when production stops registering the callback.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class UrlNormalizationCallbackTest {

    private val dbName = "callback-test"
    private val rawUrl = "HTTPS://WWW.Example.com/Roses/?utm_source=feed"
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase(dbName)
        prefs().edit().clear().commit()
    }

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun appDatabase_backfillsNormalizedUrlAndSetsFlagOnOpen() = runTest {
        seedRowWithoutNormalizedUrl()
        assertFalse(backfillFlag())

        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            // The first DAO call opens the database, which runs the open callback.
            val article = db.articleDao().getArticleById("a1")

            assertTrue(backfillFlag())
            assertEquals(normalizeUrl(rawUrl), article?.normalizedUrl)
        } finally {
            db.close()
        }
    }

    @Test
    fun v1OnlyInstall_recomputesStaleKeyOnceAndSetsV2Flag() = runTest {
        val hashRoute = "http://m.youtube.com/#/watch?v=abc"
        // Key the old rule (fragment always dropped) stored for this link.
        val staleKey = "http://m.youtube.com/"
        seedRows(Article(itemId = "y1", title = "Video", url = hashRoute, normalizedUrl = staleKey, timeAdded = 1))
        prefs().edit().putBoolean(UrlNormalizationCallback.URL_NORMALIZATION_V1, true).commit()
        assertFalse(v2Flag())

        openConfigured { db ->
            assertEquals(hashRoute, db.articleDao().getArticleById("y1")?.normalizedUrl)
        }
        assertTrue(v2Flag())

        // Plant a stale key again; a second open with the v2 flag set must not rewrite it.
        seedRows(Article(itemId = "y1", title = "Video", url = hashRoute, normalizedUrl = staleKey, timeAdded = 1))
        openConfigured { db ->
            assertEquals(staleKey, db.articleDao().getArticleById("y1")?.normalizedUrl)
        }
    }

    @Test
    fun databaseWithoutAppConfiguration_leavesFlagUnset() = runTest {
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .setDriver(BundledSQLiteDriver())
            .build()
        try {
            db.articleDao().upsertArticles(listOf(article()))
            val stored = db.articleDao().getArticleById("a1")

            assertFalse(backfillFlag())
            assertNull(stored?.normalizedUrl)
        } finally {
            db.close()
        }
    }

    /** Writes a row with a NULL normalized_url through a database that has no callback. */
    private suspend fun seedRowWithoutNormalizedUrl() {
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .setDriver(BundledSQLiteDriver())
            .build()
        try {
            db.articleDao().upsertArticles(listOf(article()))
            assertNull(db.articleDao().getArticleById("a1")?.normalizedUrl)
        } finally {
            db.close()
        }
    }

    /** Upserts rows through a database that has no callback, keeping their stored keys as given. */
    private suspend fun seedRows(vararg articles: Article) {
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .setDriver(BundledSQLiteDriver())
            .build()
        try {
            db.articleDao().upsertArticles(articles.toList())
        } finally {
            db.close()
        }
    }

    private suspend fun openConfigured(block: suspend (AppDatabase) -> Unit) {
        val db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .configureAppDatabase(context)
            .build()
        try {
            // The first DAO call opens the database, which runs the open callback.
            block(db)
        } finally {
            db.close()
        }
    }

    private fun v2Flag() = prefs().getBoolean(UrlNormalizationCallback.URL_NORMALIZATION_V2, false)

    private fun article() =Article(itemId = "a1", title = "Growing roses", url = rawUrl, timeAdded = 1)

    private fun prefs() = context.getSharedPreferences("db_migrations", Context.MODE_PRIVATE)

    private fun backfillFlag() = prefs().getBoolean("url_normalization_v1", false)
}
