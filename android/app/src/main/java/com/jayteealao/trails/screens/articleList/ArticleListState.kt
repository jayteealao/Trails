package com.jayteealao.trails.screens.articleList

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import com.jayteealao.trails.R
import com.jayteealao.trails.data.LibraryState
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.screens.components.ErrorMessage

/**
 * Consolidated UI state for ArticleListScreen
 * Note: Paging flows (articles, favoriteArticles, etc.) remain separate
 * as they are reactive data streams that don't fit into consolidated state
 */
data class ArticleListState(
    val selectedTag: String? = null,
    val sortOption: ArticleSortOption = ArticleSortOption.Newest,
    val tags: List<String> = emptyList(),
    val selectedArticle: ArticleItem = EMPTYARTICLEITEM,
    val databaseSync: Boolean = false,
    val selectedTab: ArticleListTab = ArticleListTab.HOME,
    /** Why the library on this phone is empty, or that it is not. */
    val library: LibraryState = LibraryState(),
    /** Where reading [tags] stands. */
    val tagsLoad: TagsLoad = TagsLoad.LOADING,
)

/**
 * One-time events for ArticleListScreen
 */
sealed interface ArticleListEvent {
    data class NavigateToArticle(val itemId: String) : ArticleListEvent
    data class ShowSnackbar(val message: String) : ArticleListEvent
    data class ShowToast(val message: String) : ArticleListEvent

    /** A failure in fixed words; [retry] repeats what failed, when it can be repeated. */
    data class ShowError(val message: ErrorMessage, val retry: (() -> Unit)? = null) : ArticleListEvent
    data class ShareArticle(val title: String, val url: String) : ArticleListEvent
    data class CopyLink(val url: String, val label: String = "Article URL") : ArticleListEvent
}

enum class ArticleListTab(val label: String, val icon: @Composable () -> Unit) {
    HOME("Home", { Icon(painter = painterResource(id = R.drawable.home_24px), contentDescription = "Home")}),
    FAVOURITES("Favourites", { Icon(painter = painterResource(id = R.drawable.favorite_24px), contentDescription = "Favourites")}),
    ARCHIVE("Archive", { Icon(painter = painterResource(id = R.drawable.archive_icon_24), contentDescription = "Archive")}),
    TAGS("Tags", { Icon(painter = painterResource(id = R.drawable.tag_24px), contentDescription = "Tags")})
}

enum class ArticleSortOption(val label: String) {
    Newest("Newest"),
    Popular("Popular"),
}
