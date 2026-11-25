package com.jayteealao.trails.screens.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.screens.articleDetail.ArchiveTabIcons
import com.jayteealao.trails.screens.articleDetail.NOTICE_ICON_SIZE
import com.jayteealao.trails.screens.articleDetail.NOTICE_MAX_WIDTH
import com.jayteealao.trails.screens.articleDetail.ReaderNoticeIcons
import com.jayteealao.trails.screens.articleDetail.noticeTopOffset
import com.jayteealao.trails.screens.theme.TrailsTheme
import com.jayteealao.trails.screens.theme.piazzollaFont

/** How much weight the button of a [NoticeAction] has. */
enum class NoticeActionStyle { FILLED, TONAL, TEXT }

/** One way out of the state that a [Notice] tells. */
data class NoticeAction(
    val label: String,
    val style: NoticeActionStyle,
    val onClick: () -> Unit,
)

/** The icons that only the shared notice uses, in the stroke of the tab icons. */
object NoticeIcons {
    /** An open book: a library with nothing in it yet. */
    val Book: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon(
            "Book",
            "M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z",
            "M12 6v14",
        )
    }
}

/** The offset of a notice from the top of a tall area; a short area has less. */
private val TOP_OFFSET: Dp = 64.dp

private val TitleStyle = TextStyle(
    fontFamily = piazzollaFont,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
    lineBreak = LineBreak.Heading,
)

/**
 * What an empty, failed or no-match screen says in place of its content: an icon, a title, an
 * optional line and the ways out. The words carry the state, so the icon has no description, and
 * the error colour is on the icon only. The words are one polite live region; [actions] are
 * outside it, so a screen reader reaches each button on its own. The notice scrolls, so a large
 * font or a short window hides nothing.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Notice(
    icon: ImageVector,
    title: String,
    text: String?,
    modifier: Modifier = Modifier,
    isError: Boolean = false,
    actions: List<NoticeAction> = emptyList(),
) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(modifier) {
        val topOffset = minOf(TOP_OFFSET, noticeTopOffset(maxHeight))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = topOffset, end = 16.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = NOTICE_MAX_WIDTH)
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(NOTICE_ICON_SIZE),
                    tint = if (isError) colors.error else colors.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = title,
                    style = TitleStyle,
                    color = colors.onBackground,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                if (text != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodyLarge.copy(lineBreak = LineBreak.Heading),
                        color = colors.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            if (actions.isNotEmpty()) {
                // Each button is 40 dp to look at and adds its own 48 dp touch target.
                Spacer(Modifier.height(16.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    actions.forEach { NoticeButton(it) }
                }
            }
        }
    }
}

@Composable
private fun NoticeButton(action: NoticeAction) {
    val label = @Composable { Text(action.label, textAlign = TextAlign.Center) }
    when (action.style) {
        NoticeActionStyle.FILLED -> Button(onClick = action.onClick) { label() }
        NoticeActionStyle.TONAL -> FilledTonalButton(
            onClick = action.onClick,
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            ),
        ) { label() }
        NoticeActionStyle.TEXT -> TextButton(onClick = action.onClick) { label() }
    }
}

@Composable
private fun NoticePreviews(darkTheme: Boolean = false) {
    TrailsTheme(darkTheme = darkTheme) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Column {
                Notice(
                    icon = NoticeIcons.Book,
                    title = "Your library starts here",
                    text = "In any app, share a link and choose Trails. Sign in to bring back articles you saved before.",
                    actions = listOf(NoticeAction("Sign in", NoticeActionStyle.TONAL) {}),
                )
                Notice(
                    icon = ReaderNoticeIcons.Failed,
                    title = "Favourites did not load",
                    text = "The articles are still saved. Try again.",
                    isError = true,
                    actions = listOf(NoticeAction("Try again", NoticeActionStyle.FILLED) {}),
                )
            }
        }
    }
}

@Composable
private fun WorstNotice() {
    TrailsTheme(darkTheme = false) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Notice(
                icon = ReaderNoticeIcons.Failed,
                title = "Your library did not finish loading",
                text = "1,284 articles for aleksandra.wisniewska-kowalczyk+reading-archive@mail.example.org " +
                    "are still on the server. Nothing is lost.",
                modifier = Modifier.fillMaxSize(),
                isError = true,
                actions = listOf(
                    NoticeAction("Try again", NoticeActionStyle.FILLED) {},
                    NoticeAction("Open Settings", NoticeActionStyle.TEXT) {},
                ),
            )
        }
    }
}

@Preview(name = "Notice • light", showBackground = true, widthDp = 411)
@Composable
private fun NoticeLightPreview() {
    NoticePreviews()
}

@Preview(
    name = "Notice • dark",
    showBackground = true,
    widthDp = 411,
    uiMode = Configuration.UI_MODE_NIGHT_YES,
)
@Composable
private fun NoticeDarkPreview() {
    NoticePreviews(darkTheme = true)
}

@Preview(name = "Notice • worst", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun NoticeWorstPreview() {
    WorstNotice()
}

@Preview(name = "Notice • large font", showBackground = true, widthDp = 360, heightDp = 640, fontScale = 2f)
@Composable
private fun NoticeLargeFontPreview() {
    WorstNotice()
}
