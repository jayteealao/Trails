package com.jayteealao.trails

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import timber.log.Timber

/**
 * The application plants Timber trees only in debug builds: a release build plants none and so
 * writes no log output, while a debug build keeps the logcat and Firestore trees.
 */
class TrailsLogTreesTest {

    private val stubTree = object : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) = Unit
    }

    @Before
    fun setUp() {
        Timber.uprootAll()
    }

    @After
    fun tearDown() {
        Timber.uprootAll()
    }

    @Test
    fun `release planting plants no tree and never builds the Firestore tree`() {
        plantLogTrees(debug = false) { error("the Firestore log tree must not be built in release") }

        assertEquals(0, Timber.treeCount)
    }

    @Test
    fun `debug planting plants the logcat and Firestore trees`() {
        var built = 0
        plantLogTrees(debug = true) { built++; stubTree }

        assertEquals(2, Timber.treeCount)
        assertEquals(1, built)
        assertEquals(stubTree, Timber.forest()[1])
    }

    @Test
    fun `the build type's own constant decides the trees`() {
        plantLogTrees(BuildConfig.DEBUG) { stubTree }

        assertEquals(if (BuildConfig.DEBUG) 2 else 0, Timber.treeCount)
    }
}
