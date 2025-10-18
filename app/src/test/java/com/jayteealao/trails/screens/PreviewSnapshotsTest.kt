package com.jayteealao.trails.screens

import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import com.github.takahirom.roborazzi.RoborazziRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jayteealao.trails.GreetingPreview
import com.jayteealao.trails.screens.articleList.components.TagItemLongPreview
import com.jayteealao.trails.screens.articleList.components.TagItemShortPreview

@RunWith(AndroidJUnit4::class)
class PreviewSnapshotsTest {

    private val composeTestRule: ComposeContentTestRule = createComposeRule()

    @get:Rule
    val roborazziRule = RoborazziRule(
        composeRule = composeTestRule,
        options = RoborazziRule.Options(
            outputDirectoryPath = "src/test/snapshots"
        )
    )

    @Test
    fun captureGreetingPreview() {
        roborazziRule.snapshot("GreetingPreview") {
            GreetingPreview()
        }
    }

    @Test
    fun captureTagItemShortPreview() {
        roborazziRule.snapshot("TagItemShortPreview") {
            TagItemShortPreview()
        }
    }

    @Test
    fun captureTagItemLongPreview() {
        roborazziRule.snapshot("TagItemLongPreview") {
            TagItemLongPreview()
        }
    }
}
