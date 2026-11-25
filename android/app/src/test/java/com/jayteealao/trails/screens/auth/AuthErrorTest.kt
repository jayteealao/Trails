package com.jayteealao.trails.screens.auth

import android.app.Application
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.AuthCredential
import com.jayteealao.trails.data.AuthRepository
import com.jayteealao.trails.data.account.LocalDataOwner
import com.jayteealao.trails.data.account.PushThenWipe
import com.jayteealao.trails.screens.components.ErrorMessage
import com.jayteealao.trails.screens.theme.TrailsTheme
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeoutException

/** A failed sign-in says why once, in fixed words, whichever way it failed. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class AuthErrorTest {

    @get:Rule
    val rule = createComposeRule()

    private val offlineCauses = listOf(
        FirebaseNetworkException(RAW),
        TimeoutException(RAW),
        RuntimeException(RAW, FirebaseNetworkException(RAW)),
        ApiException(Status(CommonStatusCodes.NETWORK_ERROR, RAW)),
    )
    private val otherCauses = listOf(
        IllegalStateException(RAW),
        ApiException(Status(CommonStatusCodes.DEVELOPER_ERROR, RAW)),
    )

    @Test
    fun eachCause_hasItsWords() {
        offlineCauses.forEach { assertEquals(ErrorMessage.SIGN_IN_OFFLINE, signInErrorOf(it)) }
        otherCauses.forEach { assertEquals(ErrorMessage.SIGN_IN_FAILED, signInErrorOf(it)) }
    }

    @Test
    fun everyWayToSignIn_endsInTheErrorState() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val credential = mockk<AuthCredential>()
            val repository = mockk<AuthRepository> {
                every { getCurrentUser() } returns null
                coEvery { signInAnonymously() } throws TimeoutException(RAW)
                coEvery { signInWithCredential(credential) } throws FirebaseNetworkException(RAW)
                coEvery { linkWithCredential(credential) } throws IllegalStateException(RAW)
            }
            val viewModel = AuthViewModel(repository, mockk<LocalDataOwner>(), mockk<PushThenWipe>())

            viewModel.signInAnonymously()
            advanceUntilIdle()
            assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_OFFLINE), viewModel.state.value)

            viewModel.linkWithCredential(credential)
            advanceUntilIdle()
            assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_FAILED), viewModel.state.value)

            viewModel.signInWithCredential(credential)
            advanceUntilIdle()
            assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_OFFLINE), viewModel.state.value)

            viewModel.signInFailed(IllegalStateException(RAW))
            assertEquals(AuthUiState.Error(ErrorMessage.SIGN_IN_FAILED), viewModel.state.value)
        } finally {
            Dispatchers.resetMain()
        }
    }

    private fun assertShownOnce(message: ErrorMessage, words: String) {
        var google = 0
        var guest = 0
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                AuthErrorContent(message, onRetryGoogle = { google++ }, onContinueAsGuest = { guest++ })
            }
        }

        rule.onAllNodesWithText(words, useUnmergedTree = true).assertCountEquals(1)
        rule.onAllNodesWithText(RAW, substring = true, useUnmergedTree = true).assertCountEquals(0)
        rule.onNode(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            .assert(hasText(words))
        rule.onNodeWithText("Retry with Google").performClick()
        rule.onNodeWithText("Continue as Guest Instead").performClick()
        assertEquals(1, google)
        assertEquals(1, guest)
    }

    @Test
    fun offline_isShownOnce() = assertShownOnce(
        signInErrorOf(offlineCauses.first()),
        "You’re offline, so you were not signed in. Connect, then try again.",
    )

    @Test
    fun anyOtherFailure_isShownOnce() = assertShownOnce(
        signInErrorOf(otherCauses.first()),
        "Sign-in did not finish. Try again.",
    )

    private companion object {
        const val RAW = "raw text of the exception"
    }
}
