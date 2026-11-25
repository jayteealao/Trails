package com.jayteealao.trails.screens.settings

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.screens.theme.TrailsTheme
import kotlin.math.roundToInt

/**
 * One row of Settings: its name with an optional hint, then a value or a control at the end. A long
 * value takes at most 60% of the row and wraps, so the name is never pushed out.
 */
@Composable
internal fun SettingRow(
    title: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    value: String? = null,
    control: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (hint != null) {
                Text(
                    text = hint,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (value != null) {
            Text(
                text = value,
                modifier = Modifier.maxWidthFraction(0.6f),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.End,
            )
        }
        control?.invoke()
    }
}

/** At most [fraction] of the width on offer; less when the content is narrower. */
private fun Modifier.maxWidthFraction(fraction: Float): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(
        constraints.copy(minWidth = 0, maxWidth = (constraints.maxWidth * fraction).roundToInt()),
    )
    layout(placeable.width, placeable.height) { placeable.placeRelative(0, 0) }
}

@Composable
private fun SettingRowPreviews(account: String, darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                SettingRow(title = "Account", value = account)
                SettingRow(
                    title = "Card layout",
                    hint = "Display articles as cards with spacing",
                    control = { Switch(checked = true, onCheckedChange = null) },
                )
            }
        }
    }
}

@Preview(name = "Setting row • light", showBackground = true, widthDp = 411)
@Composable
private fun SettingRowLightPreview() {
    SettingRowPreviews("mara@example.org")
}

@Preview(
    name = "Setting row • dark",
    showBackground = true,
    widthDp = 411,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun SettingRowDarkPreview() {
    SettingRowPreviews("Guest", darkTheme = true)
}

@Preview(name = "Setting row • worst", showBackground = true, widthDp = 320, fontScale = 2f)
@Composable
private fun SettingRowWorstPreview() {
    SettingRowPreviews("aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org")
}
