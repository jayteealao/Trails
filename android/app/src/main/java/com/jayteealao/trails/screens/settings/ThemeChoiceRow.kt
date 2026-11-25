package com.jayteealao.trails.screens.settings

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.data.ThemeChoice
import com.jayteealao.trails.screens.theme.TrailsTheme

private val ThemeChoice.label: String
    get() = when (this) {
        ThemeChoice.SYSTEM -> "System"
        ThemeChoice.LIGHT -> "Light"
        ThemeChoice.DARK -> "Dark"
    }

private val ThemeChoice.hint: String
    get() = when (this) {
        ThemeChoice.SYSTEM -> "Follows your phone"
        ThemeChoice.LIGHT -> "Always light"
        ThemeChoice.DARK -> "Always dark"
    }

/** The check mark of the chosen option, for tests; it has no words of its own. */
internal const val THEME_CHOICE_CHECK_TAG = "theme-choice-check"

/** The space between the check mark and the label, as the Material segmented button has it. */
private val CheckSpacing = 8.dp

/** The start and end padding of an option, as the Material segmented button has it. */
private val OptionPadding = 12.dp

/**
 * The theme setting: what the app does now, then System, Light and Dark. The options are the
 * segments of one row; when the widest label does not fit its third of the width (a large font on a
 * small phone) they stack instead, so no word breaks. A check mark shows the chosen one.
 */
@Composable
internal fun ThemeChoiceRow(
    choice: ThemeChoice,
    onChoose: (ThemeChoice) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        SettingRow(title = "Theme", hint = choice.hint)
        BoxWithConstraints(Modifier.padding(top = 8.dp)) {
            val measurer = rememberTextMeasurer()
            val style = MaterialTheme.typography.labelLarge
            val segment = maxWidth / ThemeChoice.entries.size
            val widestLabel = with(LocalDensity.current) {
                ThemeChoice.entries.maxOf { measurer.measure(it.label, style).size.width }.toDp()
            }
            val needed = widestLabel + SegmentedButtonDefaults.IconSize + CheckSpacing + OptionPadding * 2
            if (needed <= segment) {
                SegmentedChoices(choice, onChoose)
            } else {
                StackedChoices(choice, onChoose)
            }
        }
    }
}

@Composable
private fun SegmentedChoices(choice: ThemeChoice, onChoose: (ThemeChoice) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        ThemeChoice.entries.forEachIndexed { index, option ->
            SegmentedButton(
                selected = option == choice,
                onClick = { onChoose(option) },
                shape = SegmentedButtonDefaults.itemShape(index, ThemeChoice.entries.size),
                modifier = Modifier.heightIn(min = 48.dp),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    activeContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
                icon = { SegmentedButtonDefaults.Icon(option == choice, activeContent = { CheckMark() }) },
            ) {
                Text(option.label)
            }
        }
    }
}

@Composable
private fun StackedChoices(choice: ThemeChoice, onChoose: (ThemeChoice) -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.fillMaxWidth().selectableGroup()) {
            ThemeChoice.entries.forEach { option ->
                val selected = option == choice
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = { onChoose(option) },
                        )
                        .heightIn(min = 48.dp)
                        .padding(horizontal = OptionPadding, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(CheckSpacing),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (selected) CheckMark() else Spacer(Modifier.size(SegmentedButtonDefaults.IconSize))
                    Text(
                        text = option.label,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun CheckMark() {
    Icon(
        painter = painterResource(R.drawable.check_24px),
        // The option already reads as selected.
        contentDescription = null,
        modifier = Modifier
            .size(SegmentedButtonDefaults.IconSize)
            .testTag(THEME_CHOICE_CHECK_TAG),
        tint = MaterialTheme.colorScheme.onPrimaryContainer,
    )
}

@Composable
private fun ThemeChoicePreview(first: ThemeChoice, darkTheme: Boolean = false) {
    var choice by remember { mutableStateOf(first) }
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            ThemeChoiceRow(choice, onChoose = { choice = it }, Modifier.padding(horizontal = 16.dp))
        }
    }
}

@Preview(name = "Theme choice • light", showBackground = true, widthDp = 411)
@Composable
private fun ThemeChoiceLightPreview() {
    ThemeChoicePreview(ThemeChoice.SYSTEM)
}

@Preview(
    name = "Theme choice • dark",
    showBackground = true,
    widthDp = 411,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun ThemeChoiceDarkPreview() {
    ThemeChoicePreview(ThemeChoice.DARK, darkTheme = true)
}

@Preview(name = "Theme choice • large font", showBackground = true, widthDp = 320, fontScale = 2f)
@Composable
private fun ThemeChoiceLargeFontPreview() {
    ThemeChoicePreview(ThemeChoice.LIGHT)
}
