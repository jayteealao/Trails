package com.jayteealao.trails.screens.articleDetail

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
