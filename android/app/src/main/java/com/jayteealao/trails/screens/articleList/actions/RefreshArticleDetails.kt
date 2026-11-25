package com.jayteealao.trails.screens.articleList.actions

import com.jayteealao.trails.common.normalizeUrl
import com.jayteealao.trails.data.ArticleRepository
import kotlinx.coroutines.CancellationException
import me.saket.unfurl.Unfurler
import timber.log.Timber

/** How reading the details of an article again ended. */
sealed interface DetailsRefresh {
    data class Updated(val title: String, val url: String, val image: String?) : DetailsRefresh

    /** The article is not on this phone. */
    data object Missing : DetailsRefresh

    data object NoLink : DetailsRefresh

    /** The page could not be read; the stored details are as they were. */
    data object Failed : DetailsRefresh
}

/**
 * Reads the page of [itemId] again and stores its title, image and excerpt. A page that cannot be
 * read writes nothing, and a page without a title keeps the stored one.
 */
suspend fun refreshArticleDetails(
    repository: ArticleRepository,
    unfurler: Unfurler,
    itemId: String,
): DetailsRefresh {
    val article = repository.getArticleById(itemId) ?: return DetailsRefresh.Missing
    val url = (article.url ?: article.givenUrl)?.takeIf { it.isNotBlank() } ?: return DetailsRefresh.NoLink

    val page = try {
        unfurler.unfurl(url)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Timber.w(e, "Could not read the page of %s", itemId)
        null
    } ?: return DetailsRefresh.Failed

    val title = page.title?.takeIf { it.isNotBlank() }
        ?: article.title.ifBlank { article.givenTitle }
    val image = page.thumbnail?.toString()
    val resolvedUrl = page.url.toString()
    repository.updateUnfurledDetails(
        itemId = itemId,
        title = title,
        url = resolvedUrl,
        image = image,
        hasImage = image != null,
        excerpt = page.description.orEmpty(),
        normalizedUrl = normalizeUrl(resolvedUrl),
    )
    return DetailsRefresh.Updated(title, resolvedUrl, image)
}
