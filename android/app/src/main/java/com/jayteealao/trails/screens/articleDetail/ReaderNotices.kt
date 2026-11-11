package com.jayteealao.trails.screens.articleDetail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jayteealao.trails.data.archive.ArchiveTabIcons
import com.jayteealao.trails.screens.theme.piazzollaFont

/**
 * A quiet notice that the Reader shows in place of text: a title and one line. Every notice but
 * [OFFLINE] names the Web tab as the way to read now; offline, the Web tab cannot load either.
 * [isError] notices draw their icon in the error colour, always beside their words.
 */
enum class ReaderNoticeKind(val title: String, val line: String, val isError: Boolean) {
    WAITING(
        "The text is on its way",
        "It arrives soon after you save an article. The Web tab works now.",
        false,
    ),
    OFFLINE(
        "You’re offline",
        "The text downloads when you’re back online. Articles you opened before still read offline.",
        false,
    ),
    NO_TEXT(
        "No reader text for this article",
        "The archive kept no text for this page. Read it on the Web tab.",
        false,
    ),
    FAILED(
        "The archive failed",
        "There is no reader text for this article. Read it on the Web tab.",
        true,
    ),
    EMPTY(
        "This text is empty",
        "The archive saved no words for this page. Read it on the Web tab.",
        false,
    ),
    UNREADABLE(
        "The text could not be opened",
        "The saved file did not open. Read the article on the Web tab.",
        true,
    ),
}

/** What a text body of the article screen shows: the text, the skeleton, or a notice. */
sealed interface ReaderBody {
    data object Text : ReaderBody
    data object Loading : ReaderBody

    /** A notice; with [skeleton], skeleton lines under it while the text downloads. */
    data class Notice(val kind: ReaderNoticeKind, val skeleton: Boolean = false) : ReaderBody
}

/**
 * What the app knows about the text of the open article.
 *
 * @property hasText the stored text is not blank.
 * @property loaded the first read of this open has finished.
 * @property online the default network can reach the internet.
 * @property textDownloading a text archive is downloading to the phone.
 * @property textDownloadFailed a text archive download failed, and none is running.
 * @property remoteTextPending a text archive is on the server and not on the phone yet.
 * @property localTextArchive a text archive is stored on the phone.
 * @property localTextBlank the best stored text archive opened and holds no words.
 * @property localTextUnreadable no stored text archive could be opened.
 * @property articleStatus the status of the shared article on the server, or null.
 */
data class ReaderSignals(
    val hasText: Boolean,
    val loaded: Boolean,
    val online: Boolean,
    val textDownloading: Boolean = false,
    val textDownloadFailed: Boolean = false,
    val remoteTextPending: Boolean = false,
    val localTextArchive: Boolean = false,
    val localTextBlank: Boolean = false,
    val localTextUnreadable: Boolean = false,
    val articleStatus: String? = null,
)

/**
 * The statuses of a shared article (`shared-types/WargMetadata.md`). The archive pipeline
 * derives `failed` and `abandoned` after a failure that left no usable archive, and `complete`
 * and `partial` once the archives are written, the text archives first.
 */
internal val FAILED_STATUSES = setOf("failed", "abandoned")
internal val DONE_STATUSES = setOf("complete", "partial")

/**
 * The Reader body for [s]: the text when there is any, else the skeleton on the first read,
 * else one quiet notice that says what is going on and how to read now. A final state (the
 * archive failed, or kept no text) outranks offline, because the text will not come once the
 * phone is back online.
 */
fun readerBodyFor(s: ReaderSignals): ReaderBody = when {
    s.hasText -> ReaderBody.Text
    !s.loaded -> ReaderBody.Loading
    s.textDownloading -> if (s.online) ReaderBody.Notice(ReaderNoticeKind.WAITING, skeleton = true) else offline()
    s.articleStatus in FAILED_STATUSES -> ReaderBody.Notice(ReaderNoticeKind.FAILED)
    s.remoteTextPending -> if (s.online) ReaderBody.Notice(ReaderNoticeKind.WAITING) else offline()
    s.localTextArchive && s.localTextBlank -> ReaderBody.Notice(ReaderNoticeKind.NO_TEXT)
    s.localTextArchive && s.localTextUnreadable -> ReaderBody.Notice(ReaderNoticeKind.UNREADABLE)
    s.textDownloadFailed -> if (s.online) ReaderBody.Notice(ReaderNoticeKind.UNREADABLE) else offline()
    s.articleStatus in DONE_STATUSES -> ReaderBody.Notice(ReaderNoticeKind.NO_TEXT)
    !s.online -> offline()
    else -> ReaderBody.Notice(ReaderNoticeKind.WAITING)
}

private fun offline() = ReaderBody.Notice(ReaderNoticeKind.OFFLINE)

/**
 * The body of a text archive tab: the skeleton while its file is read, the could-not-open
 * notice when the read failed, the empty notice for a file with no words, else the text.
 */
fun archiveTabBodyFor(content: String?, loadFailed: Boolean): ReaderBody = when {
    content == null -> if (loadFailed) ReaderBody.Notice(ReaderNoticeKind.UNREADABLE) else ReaderBody.Loading
    content.isBlank() -> ReaderBody.Notice(ReaderNoticeKind.EMPTY)
    else -> ReaderBody.Text
}

/** The 24-unit outline icons of the notices, in the stroke of the tab icons. */
object ReaderNoticeIcons {
    /** An hourglass: the text is on its way. */
    val Waiting: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon("Waiting", "M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9")
    }

    /** A crossed-out wifi signal: offline. */
    val Offline: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon(
            "Offline",
            "M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0M3 3l18 18",
        )
    }

    /** A page with one line: no text, or an empty text. */
    val NoText: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon("No text", "M6 3h8l4 4v14H6z", "M9 13h6")
    }

    /** A circled exclamation mark: the archive failed, or its text did not open. */
    val Failed: ImageVector by lazy {
        ArchiveTabIcons.outlineIcon("Failed", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 7v6M12 16.5v.5")
    }
}

/** The icon of a notice. */
val ReaderNoticeKind.icon: ImageVector
    get() = when (this) {
        ReaderNoticeKind.WAITING -> ReaderNoticeIcons.Waiting
        ReaderNoticeKind.OFFLINE -> ReaderNoticeIcons.Offline
        ReaderNoticeKind.NO_TEXT, ReaderNoticeKind.EMPTY -> ReaderNoticeIcons.NoText
        ReaderNoticeKind.FAILED, ReaderNoticeKind.UNREADABLE -> ReaderNoticeIcons.Failed
    }

private val NoticeTitleStyle = TextStyle(
    fontFamily = piazzollaFont,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 26.sp,
    lineBreak = LineBreak.Heading,
)

/** The widths of the skeleton lines, as fractions of the reading column. */
private val SkeletonLineWidths = listOf(0.92f, 1f, 0.84f, 1f, 0.96f, 0.70f, 1f, 0.88f, 1f, 0.60f)

/**
 * A quiet notice in the reading column: a 40 dp outline icon, a title and one line, centred 96 dp
 * from the top. The words carry the state, so the icon is hidden from screen readers; the block
 * is a polite live region, so a notice that changes while the Reader is open is read out.
 */
@Composable
fun ReaderNotice(kind: ReaderNoticeKind, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(horizontal = readerSidePadding(maxWidth))
                .padding(top = 96.dp)
                .widthIn(max = 320.dp)
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                imageVector = kind.icon,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = if (kind.isError) colors.error else colors.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = kind.title,
                style = NoticeTitleStyle,
                color = colors.onBackground,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = kind.line,
                style = MaterialTheme.typography.bodyLarge.copy(lineBreak = LineBreak.Heading),
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Still skeleton lines in the reading column while the text is read or downloads: no spinner and
 * no shimmer, since nothing moves behind the text. Read out once as "Loading the text".
 */
@Composable
fun ReaderSkeleton(modifier: Modifier = Modifier) {
    val lineColor = MaterialTheme.colorScheme.surfaceVariant
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .padding(horizontal = readerSidePadding(maxWidth))
                .padding(top = 16.dp)
                .clearAndSetSemantics { contentDescription = "Loading the text" },
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SkeletonLineWidths.forEach { width ->
                Spacer(
                    Modifier
                        .fillMaxWidth(width)
                        .height(14.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(lineColor),
                )
            }
        }
    }
}

/**
 * A text body of the article screen: [text] in the reading column, the skeleton, or a notice,
 * with skeleton lines under it while the text downloads.
 */
@Composable
fun ReaderBodyView(body: ReaderBody, text: String, modifier: Modifier = Modifier) {
    when (body) {
        ReaderBody.Text -> ArticleMarkdown(text, modifier)
        ReaderBody.Loading -> ReaderSkeleton(modifier.fillMaxSize())
        is ReaderBody.Notice -> Column(modifier.fillMaxSize()) {
            ReaderNotice(body.kind)
            if (body.skeleton) {
                ReaderSkeleton(Modifier.padding(top = 32.dp))
            }
        }
    }
}
