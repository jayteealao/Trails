package com.jayteealao.trails.screens.settings

import android.app.Application
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.yumemi.tartlet.ViewStore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** A guest sees the Upgrade row, which takes one tap at a time; a full account does not. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class AccountUpgradeRowTest {

    @get:Rule
    val rule = createComposeRule()

    private var upgrades = 0

    private fun show(isAnonymous: Boolean, email: String? = null, upgrading: Boolean = false) {
        val state = SettingsState(
            useFreedium = false,
            theme = ThemeChoice.SYSTEM,
            useCardLayout = false,
            versionName = "1.0",
            versionCode = 1,
            userEmail = email,
            isAnonymous = isAnonymous,
        )
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                SettingsScreenContent(
                    viewStore = ViewStore { state },
                    upgrading = upgrading,
                    onUpgradeAccount = { upgrades++ },
                )
            }
        }
    }

    @Test
    fun aGuest_canUpgrade() {
        show(isAnonymous = true)

        rule.onNodeWithText("Guest").assertExists()
        rule.onNodeWithText("Full account").assertExists()
        rule.onNodeWithText("Keep your articles on every device").assertExists()
        rule.onNodeWithText("Upgrade").assertIsEnabled().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(1, upgrades)
    }

    @Test
    fun whileAnUpgradeRuns_theButtonIsOff() {
        show(isAnonymous = true, upgrading = true)

        rule.onNodeWithText("Upgrade").assertIsNotEnabled().performClick()
        assertEquals(0, upgrades)
    }

    @Test
    fun aFullAccount_hasNoUpgradeRow_andShowsItsAddress() {
        show(isAnonymous = false, email = "mara@example.org")

        rule.onNodeWithText("mara@example.org").assertExists()
        rule.onNodeWithText("Full account").assertDoesNotExist()
        rule.onNodeWithText("Upgrade").assertDoesNotExist()
    }
}
