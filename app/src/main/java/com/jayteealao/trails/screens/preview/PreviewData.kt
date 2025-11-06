package com.jayteealao.trails.screens.preview

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.paging.PagingData
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.jayteealao.trails.SearchBarState
import com.jayteealao.trails.data.local.database.Article
import com.jayteealao.trails.data.models.ArticleItem
import kotlinx.coroutines.flow.flowOf

/**
 * Centralized fixtures that keep Compose previews consistent across the Trails UI layer.
 *
 * These helpers are lightweight enough to run inside Studio's preview renderer and mirror
 * production defaults (e.g. paging data, populated articles, auth states). When adding new
 * previews prefer extending this file so future contributors can immediately reuse the same
 * sample content without re-creating fake state by hand.
 */
object PreviewFixtures {
    val articleItem: ArticleItem = ArticleItem(
        itemId = "preview-article",
        title = "Exploring the Rockies in Autumn",
        url = "https://trail.example.com/rockies",
        image = "https://images.example.com/rockies.jpg",
        tagsString = "Hiking,Outdoors,Photography",
        snippet = "Pack layers, check the forecast, and plan for shorter daylight hours when hiking in the fall.",
    )

    val articleList: List<ArticleItem> = listOf(
        articleItem,
        articleItem.copy(
            itemId = "preview-article-2",
            title = "Backpacking Essentials for Weekenders",
            url = "https://trail.example.com/weekend",
            snippet = "From water filtration to lightweight shelters, here's how to prep for two nights on the trail.",
            isRead = true,
        ),
        articleItem.copy(
            itemId = "preview-article-3",
            title = "Five Scenic Winter Trail Runs",
            url = "https://trail.example.com/winter-runs",
            tagsString = "Running,Training",
            snippet = "Keep traction devices in your pack and shorten your stride to stay upright on snowy single track.",
        ),
    )

    val article: Article = Article(
        itemId = articleItem.itemId,
        resolvedId = articleItem.itemId,
        title = articleItem.title,
        givenTitle = articleItem.title,
        url = articleItem.url,
        givenUrl = articleItem.url,
        excerpt = articleItem.snippet,
        wordCount = 1420,
        favorite = "0",
        status = "0",
        wordCountMessage = "5 min read",
        image = articleItem.image,
        hasImage = true,
        hasVideo = false,
        hasAudio = false,
        sortId = 0,
        timeAdded = 1_697_452_800,
        timeUpdated = 1_697_539_200,
        timeRead = null,
        timeFavorited = 0,
        timeToRead = 6,
        listenDurationEstimate = 0,
        text = "# Trail Conditions\nLate season storms can leave unexpected snow on north facing slopes. Carry traction and be prepared to turn around.",
        articleId = "12345",
        resolved = 10,
    )

    val authRequestToken: String = "https://getpocket.com/auth/authorize?request_token=preview-token"
    val authAccessToken: String = "preview-access-token"
}

@Composable
fun rememberPreviewArticles(): LazyPagingItems<ArticleItem> {
    val pagingDataFlow = remember { flowOf(PagingData.from(PreviewFixtures.articleList)) }
    return pagingDataFlow.collectAsLazyPagingItems()
}

fun previewSearchBarState(
    active: Boolean = false,
    query: String = "",
): SearchBarState = SearchBarState(active).apply { searchText = query }
