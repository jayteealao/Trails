package com.jayteealao.trails.testing

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import com.jayteealao.trails.data.local.database.AppDatabase

/**
 * An in-memory [AppDatabase] on the bundled SQLite engine for JVM (Robolectric) tests.
 *
 * The engine is the same SQLite build the app ships, so queries that depend on its
 * features (FTS, query planning) behave on the host as they do on a device. No
 * migrations and no open callback are registered: each test starts from the current
 * schema, empty.
 */
object JvmRoomDatabase {
    fun create(context: Context): AppDatabase =
        Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(BundledSQLiteDriver())
            .build()
}
