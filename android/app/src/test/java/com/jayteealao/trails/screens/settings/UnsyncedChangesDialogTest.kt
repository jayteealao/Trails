package com.jayteealao.trails.screens.settings

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.data.account.UnsyncedChangesDialogState
import com.jayteealao.trails.data.account.WipeReason
import com.jayteealao.trails.screens.theme.TrailsTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Every state of the unsynced-changes dialog renders the board copy and buttons, the
 * buttons call their actions, and every button is at least 48 dp tall.
 */
@RunWith(RobolectricTestRunner::class)
// Plain Application so Robolectric does not boot the Hilt app, whose onCreate starts Firebase.
@Config(sdk = [33], qualifiers = "w412dp-h915dp", application = Application::class)
class UnsyncedChangesDialogTest {

    @get:Rule
    val rule = createComposeRule()

    private var keeps = 0
    private var confirms = 0
    private var cancels = 0

    private fun show(state: UnsyncedChangesDialogState) {
        rule.setContent {
            TrailsTheme(darkTheme = false) {
                UnsyncedChangesDialog(
                    state = state,
                    onKeep = { keeps++ },
                    onConfirm = { confirms++ },
                    onCancelPush = { cancels++ },
                )
            }
        }
    }

    private fun assertButton(text: String) {
        rule.onNodeWithText(text).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun pushFailed_clearData_many() {
        show(UnsyncedChangesDialogState.PushFailed(42, WipeReason.CLEAR_DATA, "jo.reader@example.com"))

        rule.onNodeWithText("Changes not backed up").assertExists()
        rule.onNodeWithText("42 changes on this device are not backed up. Clearing data deletes them.").assertExists()
        rule.onNodeWithText("Current account").assertDoesNotExist()
        assertButton("Keep data")
        assertButton("Clear anyway")

        rule.onNodeWithText("Keep data").performClick()
        rule.onNodeWithText("Clear anyway").performClick()
        assertEquals(1, keeps)
        assertEquals(1, confirms)
    }

    @Test
    fun pushFailed_clearData_one() {
        show(UnsyncedChangesDialogState.PushFailed(1, WipeReason.CLEAR_DATA, null))

        rule.onNodeWithText("Change not backed up").assertExists()
        rule.onNodeWithText("1 change on this device is not backed up. Clearing data deletes it.").assertExists()
        assertButton("Keep data")
        assertButton("Clear anyway")
    }

    @Test
    fun pushFailed_accountSwitch_namesTheCurrentAccount() {
        show(UnsyncedChangesDialogState.PushFailed(3, WipeReason.ACCOUNT_SWITCH, "jo.reader@example.com"))

        rule.onNodeWithText("Sign in to a different account?").assertExists()
        rule.onNodeWithText(
            "3 changes on this device are not backed up. Signing in to another account clears this device and deletes them."
        ).assertExists()
        rule.onNodeWithText("Current account").assertExists()
        rule.onNodeWithText("jo.reader@example.com").assertExists()
        assertButton("Keep data")
        assertButton("Switch anyway")

        rule.onNodeWithText("Switch anyway").performClick()
        assertEquals(1, confirms)
    }

    @Test
    fun pushFailed_accountSwitch_guestOwner() {
        show(UnsyncedChangesDialogState.PushFailed(3, WipeReason.ACCOUNT_SWITCH, null))

        rule.onNodeWithText("Guest account").assertExists()
    }

    @Test
    fun worstCase_capsTheCount_andKeepsBothButtons() {
        show(
            UnsyncedChangesDialogState.PushFailed(
                1000,
                WipeReason.ACCOUNT_SWITCH,
                "aleksandra.wisniewska-kowalczyk.reading-archive+trails@mail.research.example.co.uk",
            )
        )

        rule.onNodeWithText("More than 999 changes", substring = true).assertExists()
        assertButton("Keep data")
        assertButton("Switch anyway")
    }

    @Test
    fun pushing_showsProgressAndOneCancel() {
        show(UnsyncedChangesDialogState.Pushing(42))

        rule.onNodeWithText("Backing up changes").assertExists()
        rule.onNodeWithText("Sending 42 changes to your account before clearing this device.").assertExists()
        rule.onNodeWithText("This stops on its own if there is no connection.").assertExists()
        rule.onNodeWithContentDescription("Backing up").assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(1)
        assertButton("Cancel")

        rule.onNodeWithText("Cancel").performClick()
        assertEquals(1, cancels)
        assertEquals(0, keeps + confirms)
    }

    @Test
    fun wiping_hasNoButtons() {
        show(UnsyncedChangesDialogState.Wiping)

        rule.onNodeWithText("Clearing data").assertExists()
        rule.onNodeWithText("Deleting articles, tags and archived pages from this device.").assertExists()
        rule.onNodeWithContentDescription("Clearing").assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun hidden_rendersNothing() {
        show(UnsyncedChangesDialogState.Hidden)

        rule.onAllNodesWithText("not backed up", substring = true).assertCountEquals(0)
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
    }
}
