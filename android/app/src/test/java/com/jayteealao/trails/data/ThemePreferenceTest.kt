package com.jayteealao.trails.data

import android.app.Application
import android.content.Context
import android.os.Looper
import com.jayteealao.trails.screens.settings.SettingsPreferenceKeys
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The theme choice over real preferences: the old Dark mode switch decides only while nothing is
 * chosen, a choice outlives the app, and a change or a clear reaches whoever listens.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], application = Application::class)
class ThemePreferenceTest {

    private val context: Context = RuntimeEnvironment.getApplication()
    private val manager = SharedPreferencesManager(context)
    private val preference = ThemePreference(manager)

    @Before
    fun clearPreferences() {
        manager.clear()
        runPostedWork()
    }

    @After
    fun runPostedWork() = shadowOf(Looper.getMainLooper()).idle()

    private fun oldSwitch(on: Boolean) = manager.saveBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED, on)

    @Test
    fun noValue_isSystem() = assertEquals(ThemeChoice.SYSTEM, preference.current())

    @Test
    fun oldSwitchOn_isDark() {
        oldSwitch(true)
        assertEquals(ThemeChoice.DARK, preference.current())
    }

    @Test
    fun oldSwitchOff_isSystem() {
        oldSwitch(false)
        assertEquals(ThemeChoice.SYSTEM, preference.current())
    }

    @Test
    fun chosenSystem_winsOverTheOldSwitch() {
        oldSwitch(true)
        preference.set(ThemeChoice.SYSTEM)
        assertEquals(ThemeChoice.SYSTEM, preference.current())
    }

    @Test
    fun unknownName_followsTheOldSwitch() {
        manager.saveString(SettingsPreferenceKeys.THEME_CHOICE, "SEPIA")
        assertEquals(ThemeChoice.SYSTEM, preference.current())
        oldSwitch(true)
        assertEquals(ThemeChoice.DARK, preference.current())
    }

    @Test
    fun choice_isKeptByANewPreference_andLeavesTheOldSwitch() {
        oldSwitch(true)
        ThemeChoice.entries.forEach { choice ->
            preference.set(choice)
            assertEquals(choice, ThemePreference(SharedPreferencesManager(context)).current())
        }
        assertTrue(manager.getBoolean(SettingsPreferenceKeys.DARK_MODE_ENABLED))
    }

    @Test
    fun choices_followASet_andAClear() = runTest {
        val seen = mutableListOf<ThemeChoice>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { preference.choices.collect { seen += it } }

        preference.set(ThemeChoice.DARK)
        runPostedWork()
        manager.saveBoolean(SettingsPreferenceKeys.USE_CARD_LAYOUT, true)
        runPostedWork()
        manager.clear()
        runPostedWork()

        assertEquals(listOf(ThemeChoice.SYSTEM, ThemeChoice.DARK, ThemeChoice.SYSTEM), seen)
    }

    @Test
    fun isDark_followsThePhoneOnlyForSystem() {
        assertTrue(ThemeChoice.SYSTEM.isDark(systemDark = true))
        assertFalse(ThemeChoice.SYSTEM.isDark(systemDark = false))
        assertFalse(ThemeChoice.LIGHT.isDark(systemDark = true))
        assertTrue(ThemeChoice.DARK.isDark(systemDark = false))
    }
}
