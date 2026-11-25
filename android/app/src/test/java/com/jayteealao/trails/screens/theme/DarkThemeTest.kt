package com.jayteealao.trails.screens.theme

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.junit4.createComposeRule
import com.jayteealao.trails.IntentActivity
import com.jayteealao.trails.MainActivity
import com.jayteealao.trails.data.SharedPreferencesManager
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.data.ThemePreference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The theme of the app: System follows the night mode of the phone, Light and Dark do not, the
 * first frame already has the saved choice, and both activities keep their screen on a change.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class DarkThemeTest {

    @get:Rule
    val rule = createComposeRule()

    private val context: Context = RuntimeEnvironment.getApplication()
    private val manager = SharedPreferencesManager(context)
    private val preference = ThemePreference(manager)

    private var night by mutableStateOf(false)

    /** The value of each frame. */
    private val frames = mutableListOf<Boolean>()

    @Before
    fun clearPreferences() {
        manager.clear()
        runPostedWork()
    }

    @After
    fun runPostedWork() = shadowOf(Looper.getMainLooper()).idle()

    private fun show() = rule.setContent {
        val configuration = Configuration(LocalConfiguration.current).apply {
            uiMode = if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        }
        CompositionLocalProvider(LocalConfiguration provides configuration) {
            val dark = rememberDarkTheme(preference)
            SideEffect { frames += dark }
        }
    }

    private fun phone(dark: Boolean): Boolean {
        rule.runOnIdle { night = dark }
        rule.waitForIdle()
        return frames.last()
    }

    @Test
    fun system_followsThePhoneBothWays() {
        show()

        assertEquals(false, phone(dark = false))
        assertEquals(true, phone(dark = true))
        assertEquals(false, phone(dark = false))
    }

    @Test
    fun light_staysLight() {
        preference.set(ThemeChoice.LIGHT)
        show()

        assertEquals(false, phone(dark = true))
        assertEquals(setOf(false), frames.toSet())
    }

    @Test
    fun dark_isDarkFromTheFirstFrame_andStaysDark() {
        preference.set(ThemeChoice.DARK)
        show()

        assertEquals(true, phone(dark = true))
        assertEquals(true, phone(dark = false))
        assertEquals(setOf(true), frames.toSet())
    }

    @Test
    fun aNewChoice_isAppliedAtOnce() {
        show()
        rule.runOnIdle { preference.set(ThemeChoice.DARK) }
        rule.waitForIdle()

        assertEquals(true, frames.last())
    }

    @Test
    fun bothActivities_handleAThemeChangeInPlace() {
        listOf(MainActivity::class.java, IntentActivity::class.java).forEach { activity ->
            val info = context.packageManager.getActivityInfo(ComponentName(context, activity), 0)
            assertEquals(
                activity.simpleName,
                ActivityInfo.CONFIG_UI_MODE,
                info.configChanges and ActivityInfo.CONFIG_UI_MODE,
            )
        }
    }
}
