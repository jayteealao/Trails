package com.jayteealao.trails.screens.articleList

import androidx.paging.LoadState
import com.jayteealao.trails.data.LibraryLoad
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.screens.components.NoticeActionStyle
import com.jayteealao.trails.screens.components.TRY_AGAIN
import java.text.NumberFormat

/** What a list shows: its rows, the skeleton, or a notice. */
sealed interface ArticleListBody {
    data object Rows : ArticleListBody
    data object Loading : ArticleListBody

    data class Message(
        val icon: ListNoticeIcon,
        val title: String,
        val text: String? = null,
        val isError: Boolean = false,
        val actions: List<ListAction> = emptyList(),
    ) : ArticleListBody
}

/** The icon of a list notice; the screen owns the drawings. */
enum class ListNoticeIcon { BOOK, FAVOURITE, ARCHIVE, TAG, OFFLINE, FAILED }

/** A way out that a list notice offers. */
enum class ListAction(val label: String, val style: NoticeActionStyle) {
    /** Loads the rows again. */
    RETRY_LIST(TRY_AGAIN, NoticeActionStyle.FILLED),

    /** Restores the library again. */
    RETRY_LIBRARY(TRY_AGAIN, NoticeActionStyle.FILLED),

    /** Reads the list of tags again. */
    RETRY_TAGS(TRY_AGAIN, NoticeActionStyle.FILLED),
    SIGN_IN("Sign in", NoticeActionStyle.TONAL),
    OPEN_SETTINGS("Open Settings", NoticeActionStyle.TEXT),
}

/** Where reading the list of tags stands. */
enum class TagsLoad { LOADING, LOADED, FAILED }

private const val STILL_SAVED = "The articles are still saved. Try again."

/**
 * The body of the list on [tab] (of the articles tagged [selectedTag], on the Tags tab). Rows
 * stay while a refresh runs or after one failed. On Home, first run shows only when nothing says
 * that articles exist or are on their way.
 */
fun listBodyFor(
    tab: ArticleListTab,
    selectedTag: String?,
    itemCount: Int,
    refresh: LoadState,
    library: LibraryState,
): ArticleListBody = when {
    itemCount > 0 -> ArticleListBody.Rows
    refresh is LoadState.Error -> failed(
        when (tab) {
            ArticleListTab.HOME -> "Your library did not load"
            ArticleListTab.FAVOURITES -> "Favourites did not load"
            ArticleListTab.ARCHIVE -> "Archive did not load"
            ArticleListTab.TAGS ->
                if (selectedTag == null) "Tags did not load" else "Articles tagged $selectedTag did not load"
        },
        ListAction.RETRY_LIST,
    )
    refresh is LoadState.Loading -> ArticleListBody.Loading
    else -> when (tab) {
        ArticleListTab.HOME -> emptyHome(library)
        ArticleListTab.FAVOURITES -> ArticleListBody.Message(
            icon = ListNoticeIcon.FAVOURITE,
            title = "No favourites yet",
            text = "Swipe an article to the right, or touch and hold it, to keep it here.",
        )
        ArticleListTab.ARCHIVE -> ArticleListBody.Message(
            icon = ListNoticeIcon.ARCHIVE,
            title = "Nothing archived yet",
            text = "Articles you archive wait here.",
        )
        ArticleListTab.TAGS -> if (selectedTag == null) {
            noTags()
        } else {
            ArticleListBody.Message(icon = ListNoticeIcon.TAG, title = "No articles tagged $selectedTag")
        }
    }
}

/** The body of the list of tags. */
fun tagsBodyFor(tagCount: Int, load: TagsLoad): ArticleListBody = when {
    tagCount > 0 -> ArticleListBody.Rows
    load == TagsLoad.FAILED -> failed("Tags did not load", ListAction.RETRY_TAGS)
    load == TagsLoad.LOADING -> ArticleListBody.Loading
    else -> noTags()
}

private fun emptyHome(library: LibraryState): ArticleListBody {
    val load = library.load
    return when {
        library.hasArticles == null -> ArticleListBody.Loading
        library.hasArticles -> ArticleListBody.Message(
            icon = ListNoticeIcon.BOOK,
            title = "No articles on Home",
            text = "The articles you archived are in Archive.",
        )
        load == LibraryLoad.Loading -> ArticleListBody.Loading
        !library.signedIn -> ArticleListBody.Message(
            icon = ListNoticeIcon.BOOK,
            title = "Your library starts here",
            text = "In any app, share a link and choose Trails. Sign in to bring back articles you saved before.",
            actions = listOf(ListAction.SIGN_IN),
        )
        load is LibraryLoad.Failed && load.offline -> ArticleListBody.Message(
            icon = ListNoticeIcon.OFFLINE,
            title = "Your library did not load",
            text = "You’re offline and this phone has no saved articles yet. Connect, then try again.",
            isError = true,
            actions = listOf(ListAction.RETRY_LIBRARY),
        )
        load is LibraryLoad.Failed -> ArticleListBody.Message(
            icon = ListNoticeIcon.FAILED,
            title = "Your library did not finish loading",
            text = stillOnTheServer(load.remoteCount, library.email),
            isError = true,
            actions = listOf(ListAction.RETRY_LIBRARY, ListAction.OPEN_SETTINGS),
        )
        else -> ArticleListBody.Message(
            icon = ListNoticeIcon.BOOK,
            title = "Your library starts here",
            text = "In any app, share a link and choose Trails. The article waits here, ready to read offline.",
        )
    }
}

/** What the server still holds; the count shows only when the server gave it. */
private fun stillOnTheServer(count: Int?, email: String?): String {
    val owner = if (email == null) "" else " for $email"
    return when (count) {
        null -> "Articles you saved before are still on the server. Nothing is lost."
        0 -> "Try again."
        1 -> "1 article$owner is still on the server. Nothing is lost."
        else -> "${NumberFormat.getIntegerInstance().format(count)} articles$owner are still on the server. " +
            "Nothing is lost."
    }
}

private fun noTags() = ArticleListBody.Message(
    icon = ListNoticeIcon.TAG,
    title = "No tags yet",
    text = "Add a tag to an article to find it here.",
)

private fun failed(title: String, action: ListAction) = ArticleListBody.Message(
    icon = ListNoticeIcon.FAILED,
    title = title,
    text = STILL_SAVED,
    isError = true,
    actions = listOf(action),
)
