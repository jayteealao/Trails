package com.jayteealao.trails.screens.auth

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The sign-in panel: each state has its line and its buttons, a failure is read out once in
 * fixed words, busy states take no second tap, and the longest words still fit and scroll.
 */
@RunWith(RobolectricTestRunner::class)
// Native graphics, so text is measured with its real width.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class AuthScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val taps = mutableListOf<String>()
    private val state = mutableStateOf<AuthUiState>(AuthUiState.SignedOut)

    private fun show(initial: AuthUiState, fontScale: Float = 1f, dark: Boolean = false) {
        state.value = initial
        rule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                TrailsTheme(darkTheme = dark) {
                    SignInPanel(
                        state = state.value,
                        onGoogle = { taps += "google" },
                        onGuest = { taps += "guest" },
                        onSkip = { taps += "skip" },
                        onCancel = { taps += "cancel" },
                        onAddAccount = { taps += "add" },
                    )
                }
            }
        }
    }

    private val politeLine = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)

    @Test
    fun signedOut_offersEveryWayIn() {
        show(AuthUiState.SignedOut)

        rule.onNode(isHeading() and hasText("Trails")).assertExists()
        rule.onNodeWithText("Keep your articles on every device.").assertExists()
        listOf("Continue with Google", "Continue as guest", "Skip and read what is on this phone").forEach {
            rule.onNodeWithText(it).assertIsEnabled().assertHasClickAction().assertHeightIsAtLeast(48.dp)
        }
        rule.onNodeWithText("Cancel sign-in").assertDoesNotExist()

        rule.onNodeWithText("Continue with Google").performClick()
        rule.onNodeWithText("Continue as guest").performClick()
        rule.onNodeWithText("Skip and read what is on this phone").performClick()
        assertEquals(listOf("google", "guest", "skip"), taps)
    }

    @Test
    fun loading_takesNoSecondTap_andCanBeCancelledUntilTheHandOver() {
        show(AuthUiState.Loading())

        rule.onNodeWithText("Signing you in…").assertExists()
        listOf("Continue with Google", "Continue as guest", "Skip and read what is on this phone").forEach {
            rule.onNodeWithText(it).assertIsNotEnabled()
        }
        rule.onNodeWithText("Cancel sign-in").assertIsEnabled().performClick()
        assertEquals(listOf("cancel"), taps)

        state.value = AuthUiState.Loading(canCancel = false)
        rule.waitForIdle()
        rule.onNodeWithText("Cancel sign-in").assertDoesNotExist()
    }

    @Test
    fun noGoogleAccount_offersToAddOne() {
        show(AuthUiState.NoGoogleAccount)

        rule.onNode(politeLine and hasText(ErrorMessage.GOOGLE_NO_ACCOUNT.text, substring = true)).assertExists()
        rule.onNodeWithText("Add a Google account").performClick()
        assertEquals(listOf("add"), taps)
    }

    @Test
    fun eachFailure_isOneLineReadOutPolitely_withItsButton() {
        val cases = mapOf(
            ErrorMessage.GOOGLE_OFFLINE to "Try again with Google",
            ErrorMessage.GOOGLE_FAILED to "Try again with Google",
            ErrorMessage.SIGN_IN_OFFLINE to "Continue with Google",
            ErrorMessage.SIGN_IN_FAILED to "Continue with Google",
        )
        show(AuthUiState.SignedOut)
        cases.forEach { (message, button) ->
            state.value = AuthUiState.Error(message)
            rule.waitForIdle()

            val words = signInText(message, account = null)
            rule.onAllNodesWithText(words).assertCountEquals(1)
            rule.onNode(politeLine and hasText(words)).assertExists()
            rule.onNodeWithText(button).assertIsEnabled()
        }
    }

    @Test
    fun aGoogleFailure_namesTheAccount() {
        show(AuthUiState.Error(ErrorMessage.GOOGLE_FAILED, account = "mara@example.org"))

        rule.onNodeWithText("mara@example.org", substring = true).assertExists()
    }

    @Test
    fun theWorstWords_atTwiceTheFontSize_stillReachEveryButton() {
        show(WORST_SIGN_IN_STATE, fontScale = 2f, dark = true)

        rule.onNodeWithText(WORST_SIGN_IN_STATE.account!!, substring = true).assertExists()
        rule.onNodeWithText("Skip and read what is on this phone")
            .performScrollTo()
            .assertIsDisplayed()
            .performClick()
        assertEquals(listOf("skip"), taps)
    }
}
