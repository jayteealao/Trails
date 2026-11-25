package com.jayteealao.trails.screens.articleSearch

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jayteealao.trails.R
import com.jayteealao.trails.screens.theme.TrailsTheme

/**
 * The single-line search field under the app bar. The search key of the keyboard runs [onSearch]
 * and leaves the field; a field emptied by hand calls [onClear], so old results never stay under
 * no words. Words longer than the field end in an ellipsis while it has no focus.
 */
@Composable
fun SearchField(
    text: String,
    onTextChange: (String) -> Unit,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val focusManager = LocalFocusManager.current
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface)

    Column(modifier.fillMaxWidth().background(colors.surface)) {
        BasicTextField(
            value = text,
            onValueChange = { if (it.isEmpty()) onClear() else onTextChange(it) },
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "Search" },
            textStyle = textStyle,
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(
                onSearch = {
                    focusManager.clearFocus()
                    onSearch()
                },
            ),
            interactionSource = interactions,
            cursorBrush = SolidColor(colors.primary),
        ) { innerTextField ->
            Row(
                modifier = Modifier.heightIn(min = 56.dp).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(R.drawable.search_24px),
                    contentDescription = null,
                    tint = if (focused) colors.primary else colors.onSurfaceVariant,
                )
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    val shownCut = !focused && text.isNotEmpty()
                    Box(Modifier.alpha(if (shownCut) 0f else 1f)) { innerTextField() }
                    if (shownCut || text.isEmpty()) {
                        Text(
                            text = text.ifEmpty { "Search" },
                            style = textStyle,
                            color = if (text.isEmpty()) colors.onSurfaceVariant else colors.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clearAndSetSemantics {},
                        )
                    }
                }
            }
        }
        HorizontalDivider(
            thickness = if (focused) 2.dp else Dp.Hairline,
            color = if (focused) colors.primary else colors.outlineVariant,
        )
    }
}

@Composable
private fun SearchFieldPreviews(darkTheme: Boolean) {
    TrailsTheme(darkTheme = darkTheme) {
        Column {
            SearchField(text = "", onTextChange = {}, onSearch = {}, onClear = {})
            SearchField(text = "tree", onTextChange = {}, onSearch = {}, onClear = {})
            SearchField(
                text = "Benachrichtigungseinstellungen and other compound words of one very long summer",
                onTextChange = {},
                onSearch = {},
                onClear = {},
            )
        }
    }
}

@Preview(name = "Search field • light", showBackground = true, widthDp = 411)
@Composable
private fun SearchFieldLightPreview() {
    SearchFieldPreviews(darkTheme = false)
}

@Preview(
    name = "Search field • dark",
    showBackground = true,
    widthDp = 411,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun SearchFieldDarkPreview() {
    SearchFieldPreviews(darkTheme = true)
}

@Preview(name = "Search field • large font", showBackground = true, widthDp = 360, fontScale = 2f)
@Composable
private fun SearchFieldLargeFontPreview() {
    SearchFieldPreviews(darkTheme = false)
}
