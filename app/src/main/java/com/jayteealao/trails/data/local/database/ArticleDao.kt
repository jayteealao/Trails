package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Query
import androidx.room.RewriteQueriesToDropUnusedColumns
import androidx.room.RoomWarnings
import androidx.room.Transaction
import androidx.room.Upsert
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleAuthor
import com.jayteealao.trails.network.ArticleImage
import com.jayteealao.trails.network.ArticleTag
import com.jayteealao.trails.network.ArticleVideo
import com.jayteealao.trails.data.models.ArticleSummary
import com.jayteealao.trails.network.DomainMetadata
import kotlinx.coroutines.flow.Flow

@Dao
interface ArticleDao {

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url,
        CASE WHEN favorite = '1' THEN 1 ELSE 0 END AS favorite
        FROM article
        ORDER BY timeUpdated DESC
        """
    )
    fun getArticles(): PagingSource<Int, ArticleItem>

    @Query("SELECT * FROM article ORDER BY timeAdded DESC LIMIT :limit OFFSET :offset")
    fun getArticles(offset: Int, limit: Int): List<Article>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tag AS tag ON art.itemId = tag.itemId
        WHERE art.archived_at IS NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeAdded DESC
    """
    )
    fun getArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tag AS tag ON art.itemId = tag.itemId
        WHERE art.timeFavorited > 0 AND art.archived_at IS NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeFavorited DESC, art.timeAdded DESC
    """
    )
    fun getFavoriteArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tag AS tag ON art.itemId = tag.itemId
        WHERE art.archived_at IS NOT NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.archived_at DESC, art.timeAdded DESC
    """
    )
    fun getArchivedArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        GROUP_CONCAT(allTags.tag) AS tagsString
        FROM article AS art
        INNER JOIN article_tag AS selectedTag ON
            (art.itemId = selectedTag.itemId OR art.resolvedId = selectedTag.itemId)
            AND selectedTag.tag = :tag
        LEFT JOIN article_tag AS allTags ON
            art.itemId = allTags.itemId OR art.resolvedId = allTags.itemId
        WHERE art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeAdded DESC
    """
    )
    fun getArticlesWithTag(tag: String): PagingSource<Int, ArticleItem>

    @Query(
        """
        SELECT tag
        FROM article_tag
        GROUP BY tag
        ORDER BY LOWER(tag)
    """
    )
    fun getAllTags(): Flow<List<String>>

    @Query("SELECT * FROM article WHERE itemId = :itemId")
    fun getArticleById(itemId: String): Article?

    @Query(
        """
        SELECT * FROM article
        WHERE itemId NOT IN (SELECT articleId FROM ModalArticleTable)
        ORDER BY timeAdded DESC
        LIMIT 10
        OFFSET :offset
        """
    )
    fun getArticlesWithoutModal(offset: Int): List<Article>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @RewriteQueriesToDropUnusedColumns
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url, image,
        CASE WHEN favorite = '1' THEN 1 ELSE 0 END AS favorite,
        excerpt AS snippet
        FROM article
        WHERE itemId IN (:ids)
        """
    )
    fun getArticlesByIds(ids: List<String>): List<ArticleItem>

    @Query("SELECT * FROM article WHERE url = :url OR givenUrl = :url")
    fun getArticleByUrl(url: String): Article?

    @Query("SELECT * FROM article WHERE resolved = 0 OR resolved = 1 OR resolved = 3 ORDER BY timeAdded ASC")
    suspend fun getUnresolvedArticles(): List<Article>

    @Query(
        """
        UPDATE article
        SET archived_at = :timeArchived
        WHERE itemId = :itemId
        """
    )
    suspend fun updateArchived(itemId: String, timeArchived: Long)

    @Query(
        """
        UPDATE article
        SET deleted_at = :timeDeleted
        WHERE itemId = :itemId
        """
    )
    suspend fun updateDeleted(itemId: String, timeDeleted: Long)

    @Query(
        """
        UPDATE article
        SET timeToRead = :timeToRead, listenDurationEstimate = :listenDurationEstimate, wordCount = :wordCount, resolved = 3
        WHERE itemId = :itemId
    """
    )
    suspend fun updateArticleMetrics(itemId: String, timeToRead: Int, listenDurationEstimate: Int, wordCount: Int)

    @Query("SELECT * FROM article WHERE resolved = 2 OR resolved = 1")
    suspend fun getNonMetricsArticles(): List<Article>

    @Query("SELECT * FROM article WHERE text = '0' OR text = '1'")
    suspend fun getTextEqualsZeroOrOne(): List<Article>

    @Query("UPDATE article SET text = :text, resolved = 2 WHERE itemId = :itemId")
    suspend fun updateText(itemId: String, text: String?)

    @Query("UPDATE article SET resolved = :resolved WHERE itemId IN (:itemIds)")
    suspend fun updateResolved(itemIds: List<String>, resolved: Int)

    @Query(
        """
            UPDATE article
            SET title = :title, url = :url, image = :image, hasImage = :hasImage, excerpt = :excerpt
            WHERE itemId = :itemId
            """
    )
    suspend fun updateUnfurledDetails(itemId: String, title: String, url: String, image: String?, hasImage: Boolean, excerpt: String)

    @Upsert
    suspend fun insertArticle(item: Article)

    @Upsert
    suspend fun insertArticles(items: List<Article>)

    @Upsert
    suspend fun insertArticleImages(items: List<ArticleImage>)

    @Upsert
    suspend fun insertArticleVideos(item: List<ArticleVideo>)

    @Upsert
    suspend fun insertArticleTags(items: List<ArticleTag>)

    @Upsert
    suspend fun insertArticleAuthors(items: List<ArticleAuthor>)

    @Query(
        """
        UPDATE article
        SET favorite = CASE WHEN :isFavorite THEN '1' ELSE '0' END,
            timeFavorited = CASE WHEN :isFavorite THEN :timeFavorited ELSE 0 END
        WHERE itemId = :itemId
        """
    )
    suspend fun updateFavorite(itemId: String, isFavorite: Boolean, timeFavorited: Long)

    @Query(
        """
        DELETE FROM article_tag WHERE itemId = :itemId AND tag = :tag
        """
    )
    suspend fun deleteArticleTag(itemId: String, tag: String)

    @Query(
        """
        SELECT tag FROM article_tag WHERE itemId = :itemId
    """
    )
    suspend fun getArticleTags(itemId: String): List<String>

    @Upsert
    suspend fun insertModalId(mappings: List<ModalArticleTable>)

    @Upsert
    suspend fun insertArticleSummaries(items: List<ArticleSummary>)

    @Upsert
    suspend fun insertDomainMetadata(item: DomainMetadata)

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT article.itemId, article.title,
        COALESCE(article.url, article.givenUrl) AS url,
        article.image,
        CASE WHEN article.favorite = '1' THEN 1 ELSE 0 END AS favorite
        FROM article
        JOIN article_fts ON article.itemId = article_fts.itemId
        WHERE article_fts MATCH :query
        """
    )
    suspend fun searchArticles(query: String): List<ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(
        """
        SELECT article.itemId, article.title,
        COALESCE(article.url, article.givenUrl) AS url,
        article.image,
        CASE WHEN article.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        snippet(article_fts) AS snippet,
        matchinfo(article_fts) AS matchInfo
        FROM article
        JOIN article_fts ON article.itemId = article_fts.itemId
        WHERE article_fts MATCH :query
        """
    )
    suspend fun searchArticlesWithMatchInfo(query: String): List<ArticleWithMatchInfo>

    @Query(
        """
        SELECT * FROM article
        WHERE remote_id != "0"
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLatestArticle(): Article?

    @Query(
        """
        SELECT * FROM article
        WHERE text IS NULL
        ORDER BY timeUpdated DESC
        LIMIT 10
        OFFSET :offset
    """
    )
    fun getArticlesWithoutText(offset: Int): List<Article>

    @Query(
        """
        SELECT timeUpdated FROM article
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLastUpdatedArticleTime(): Long

    @Query(
        """
        SELECT COUNT(*) FROM article
        """
    )
    fun countArticles(): Int

    @Query(
        """
        UPDATE article
        SET timeAdded = :time, timeUpdated = :time
        WHERE timeAdded = 0 AND timeUpdated = 0
        """
    )
    suspend fun backfillZeroTimestamps(time: Long)

    @Transaction
    suspend fun upsertArticle(newArticle: Article): String {
        var existingArticle: Article? = null
        if (newArticle.givenUrl != null) {
            existingArticle = getArticleByUrl(newArticle.givenUrl)
        }
        if (existingArticle == null && newArticle.url != null) {
            existingArticle = getArticleByUrl(newArticle.url)
        }
        if (existingArticle != null) {
            insertArticle(
                newArticle.copy(
                    itemId = existingArticle.itemId,
                    remoteId = existingArticle.remoteId,
                    resolvedId = existingArticle.resolvedId,
                    timeUpdated = newArticle.timeAdded,
                    timeAdded = existingArticle.timeAdded,
                    title = newArticle.title.ifBlank { existingArticle.title },
                    givenTitle = newArticle.givenTitle.ifBlank { existingArticle.givenTitle },
                    url = newArticle.url ?: existingArticle.url,
                    givenUrl = newArticle.givenUrl ?: existingArticle.givenUrl,
                    favorite = if (newArticle.favorite.isNullOrBlank()) existingArticle.favorite else newArticle.favorite,
                    status = newArticle.status.ifBlank { existingArticle.status },
                    image = newArticle.image ?: existingArticle.image,
                    hasImage = if (!newArticle.hasImage) existingArticle.hasImage else true,
                    hasVideo = if (!newArticle.hasVideo) existingArticle.hasVideo else true,
                    hasAudio = if (!newArticle.hasAudio) existingArticle.hasAudio else true,
                    listenDurationEstimate = if (newArticle.listenDurationEstimate == 0) existingArticle.listenDurationEstimate else newArticle.listenDurationEstimate,
                    wordCount = if (newArticle.wordCount == 0) existingArticle.wordCount else newArticle.wordCount,
                    wordCountMessage = if (newArticle.wordCountMessage.isNullOrBlank()) existingArticle.wordCountMessage else newArticle.wordCountMessage,
                    sortId = if (newArticle.sortId == 0) existingArticle.sortId else newArticle.sortId,
                    timeRead = if (newArticle.timeRead == null || newArticle.timeRead == 0L) existingArticle.timeRead else newArticle.timeRead,
                    timeFavorited = if (newArticle.timeFavorited == 0L) existingArticle.timeFavorited else newArticle.timeFavorited,
                    timeToRead = if (newArticle.timeToRead == 0) existingArticle.timeToRead else newArticle.timeToRead,
                    text = if (newArticle.text.isNullOrBlank()) existingArticle.text else newArticle.text,
                )
            )
            return existingArticle.itemId
        } else {
            insertArticle(newArticle)
            return newArticle.itemId
        }
    }
}
