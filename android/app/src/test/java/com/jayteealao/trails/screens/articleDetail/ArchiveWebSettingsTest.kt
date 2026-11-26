package com.jayteealao.trails.screens.articleDetail

import android.app.Application
import android.webkit.WebView
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** A saved archive shows as a still page: no scripts, no storage, no files of the phone. */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ArchiveWebSettingsTest {

    @Test
    fun anArchive_runsNoScript_andReadsNoFile() {
        val settings = WebView(RuntimeEnvironment.getApplication()).settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
        }

        settings.applyArchiveSettings()

        assertFalse(settings.javaScriptEnabled)
        assertFalse(settings.domStorageEnabled)
        assertFalse(settings.allowFileAccess)
        assertFalse(settings.allowContentAccess)
    }
}
