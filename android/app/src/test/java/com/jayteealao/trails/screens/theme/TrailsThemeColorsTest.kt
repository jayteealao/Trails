package com.jayteealao.trails.screens.theme

import android.app.Application
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Alert dialogs take the palette's container colour in both schemes, and the dark scheme
 * has a readable error colour with its on-error partner.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class TrailsThemeColorsTest {

    @get:Rule
    val rule = createComposeRule()

    private fun capture(dark: Boolean): Pair<ColorScheme, Color> {
        var scheme: ColorScheme? = null
        var dialogContainer: Color? = null
        rule.setContent {
            TrailsTheme(darkTheme = dark) {
                scheme = MaterialTheme.colorScheme
                dialogContainer = AlertDialogDefaults.containerColor
            }
        }
        rule.waitForIdle()
        return scheme!! to dialogContainer!!
    }

    @Test
    fun light_dialogContainerIsIce() {
        val (scheme, dialogContainer) = capture(dark = false)

        assertEquals(TrailsIce, scheme.surfaceContainerHigh)
        assertEquals(scheme.surfaceContainerHigh, dialogContainer)
    }

    @Test
    fun dark_dialogContainerIsMidnightVariant_andErrorPairIsReadable() {
        val (scheme, dialogContainer) = capture(dark = true)

        assertEquals(TrailsMidnightVariant, scheme.surfaceContainerHigh)
        assertEquals(scheme.surfaceContainerHigh, dialogContainer)
        assertEquals(Color(0xFFFFB4AB), scheme.error)
        assertEquals(Color(0xFF690005), scheme.onError)
    }
}
