package com.jayteealao.trails.screens.articleList

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import com.jayteealao.trails.R
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.EMPTYARTICLEITEM
import com.jayteealao.trails.data.models.PocketSummary

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
    val selectedArticleSummary: PocketSummary = PocketSummary(),
    val databaseSync: Boolean = false,
    val selectedTab: ArticleListTab = ArticleListTab.HOME
)

/**
 * One-time events for ArticleListScreen
 */
sealed interface ArticleListEvent {
    data class NavigateToArticle(val itemId: String) : ArticleListEvent
    data class ShowSnackbar(val message: String) : ArticleListEvent
    data class ShowToast(val message: String) : ArticleListEvent
    data class ShowError(val error: Throwable) : ArticleListEvent
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
