package com.jayteealao.trails.screens.articleList.testfixtures

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.paging.PagingData
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.screens.preview.PreviewFixtures
import kotlinx.coroutines.flow.flowOf

/**
 * Deterministic fakes for the JVM (Robolectric) article-list characterization tests.
 *
 * The list itself is reused from the production [PreviewFixtures] so the characterization
 * baseline tracks the same sample content Studio previews render — one source of truth for
 * "what an article row looks like" rather than a second, drifting copy. Only the fake
 * [LazyPagingItems] plumbing (which is `@Composable` and cannot live in a plain object) is
 * added here.
 */
object ArticleTestFixtures {
    /** Known, stable article list with distinct titles/ids for assertions. */
    val articles: List<ArticleItem> = PreviewFixtures.articleList

    /** The first row's stable id/title — the primary node the render tests select on. */
    val firstItemId: String = articles.first().itemId
    val firstTitle: String = articles.first().title
}

/**
 * Fake [LazyPagingItems] backed by a static [PagingData]. Mirrors the production
 * `rememberPreviewArticles()` helper so the isolated render path matches how the screen
 * is exercised in previews. Defaults to a non-empty list; pass `emptyList()` for the
 * empty-state case.
 */
@Composable
fun rememberFakeLazyPagingItems(
    items: List<ArticleItem> = ArticleTestFixtures.articles,
): LazyPagingItems<ArticleItem> {
    val flow = remember(items) { flowOf(PagingData.from(items)) }
    return flow.collectAsLazyPagingItems()
}
