package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Query
import androidx.room.RewriteQueriesToDropUnusedColumns
import androidx.room.RoomWarnings
import androidx.room.Transaction
import androidx.room.Upsert
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.network.DomainMetadata
import kotlinx.coroutines.flow.Flow

@Dao
interface ArticleDao {

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url,
        CASE WHEN favorite = '1' OR timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN timeRead IS NOT NULL AND timeRead > 0 THEN 1 ELSE 0 END AS isRead
        FROM article
        ORDER BY timeUpdated DESC
        """
    )
    fun getArticles(): PagingSource<Int, ArticleItem>

    @Query("SELECT * FROM article ORDER BY timeAdded DESC LIMIT :limit OFFSET :offset")
    fun getArticles(offset: Int, limit: Int): List<Article>

    @Query("SELECT * FROM article WHERE deleted_at IS NULL ORDER BY timeAdded DESC")
    suspend fun getAllArticles(): List<Article>

    @Query("SELECT * FROM article WHERE timeUpdated > :since AND deleted_at IS NULL ORDER BY timeUpdated DESC")
    suspend fun getArticlesModifiedSince(since: Long): List<Article>

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tags AS tag ON art.itemId = tag.itemId
        WHERE art.archived_at IS NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeAdded DESC
    """)
    fun getArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tags AS tag ON art.itemId = tag.itemId
        WHERE art.timeFavorited > 0 AND art.archived_at IS NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeFavorited DESC, art.timeAdded DESC
    """)
    fun getFavoriteArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tags AS tag ON art.itemId = tag.itemId
        WHERE art.archived_at IS NOT NULL AND art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.archived_at DESC, art.timeAdded DESC
    """)
    fun getArchivedArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        GROUP_CONCAT(allTags.tag) AS tagsString
        FROM article AS art
        INNER JOIN article_tags AS selectedTag ON
            (art.itemId = selectedTag.itemId OR art.resolvedId = selectedTag.itemId)
            AND selectedTag.tag = :tag
        LEFT JOIN article_tags AS allTags ON
            art.itemId = allTags.itemId OR art.resolvedId = allTags.itemId
        WHERE art.deleted_at IS NULL
        GROUP BY art.itemId
        ORDER BY art.timeAdded DESC
    """)
    fun getArticlesWithTag(tag: String): PagingSource<Int, ArticleItem>

    @Query(
        """
        SELECT tag
        FROM article_tags
        GROUP BY tag
        ORDER BY LOWER(tag)
    """
    )
    fun getAllTags(): Flow<List<String>>

    @Query("SELECT * FROM article WHERE itemId = :itemId")
    fun getArticleById(itemId: String): Article?

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @RewriteQueriesToDropUnusedColumns
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url, image,
        CASE WHEN favorite = '1' OR timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN timeRead IS NOT NULL AND timeRead > 0 THEN 1 ELSE 0 END AS isRead,
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
        SET archived_at = :timeArchived,
            timeUpdated = :timeArchived
        WHERE itemId = :itemId
        """
    )
    suspend fun updateArchived(itemId: String, timeArchived: Long)

    @Query(
        """
        UPDATE article
        SET deleted_at = :timeDeleted,
            timeUpdated = :timeDeleted
        WHERE itemId = :itemId
        """
    )
    suspend fun updateDeleted(itemId: String, timeDeleted: Long)

    @Query(
        """
        UPDATE article
        SET timeToRead = :timeToRead, listenDurationEstimate = :listenDurationEstimate, wordCount = :wordCount, resolved = 3
        WHERE itemId = :itemId
    """)
    suspend fun updateArticleMetrics(itemId: String, timeToRead: Int, listenDurationEstimate: Int, wordCount: Int)

    @Query("SELECT * FROM article WHERE resolved = 2 OR resolved = 1")
    suspend fun getNonMetricsArticles(): List<Article>

    @Query("SELECT * FROM article WHERE text = '0' OR text = '1'")
    suspend fun getTextEqualsZeroOrOne(): List<Article>

    @Query("UPDATE article SET text = :text, resolved = 2 WHERE itemId = :itemId")
    suspend fun updateText(itemId: String, text: String?)

    @Query("UPDATE article SET resolved = :resolved WHERE itemId IN (:itemIds)")
    suspend fun updateResolved(itemIds: List<String>, resolved: Int)

    @Query("""
            UPDATE article
            SET title = :title, url = :url, image = :image, hasImage = :hasImage, excerpt = :excerpt
            WHERE itemId = :itemId
            """)
    suspend fun updateUnfurledDetails(itemId: String, title: String, url: String, image: String?, hasImage: Boolean, excerpt: String)

    @Query("UPDATE article SET excerpt = :excerpt WHERE itemId = :itemId")
    suspend fun updateExcerpt(itemId: String, excerpt: String)

    @Upsert
    suspend fun upsertArticle(item: Article)

    @Upsert
    suspend fun upsertArticles(items: List<Article>)

    @Upsert
    suspend fun insertArticleImages(items: List<ArticleImages>)

    @Upsert
    suspend fun insertArticleVideos(item: List<ArticleVideos>)

    @Upsert
    suspend fun insertArticleTags(items: List<ArticleTags>)

    @Query(
        """
        UPDATE article
        SET favorite = CASE WHEN :isFavorite THEN '1' ELSE '0' END,
            timeFavorited = CASE WHEN :isFavorite THEN :timeFavorited ELSE 0 END,
            timeUpdated = :timeFavorited
        WHERE itemId = :itemId
        """
    )
    suspend fun updateFavorite(itemId: String, isFavorite: Boolean, timeFavorited: Long)

    @Query(
        """
        UPDATE article
        SET timeRead = CASE WHEN :isRead THEN :timestamp ELSE NULL END,
            timeUpdated = :timestamp
        WHERE itemId = :itemId
        """
    )
    suspend fun updateReadStatus(itemId: String, isRead: Boolean, timestamp: Long?)

    @Query(
        """
        UPDATE article
        SET timeUpdated = :timestamp
        WHERE itemId = :itemId
        """
    )
    suspend fun updateTimeUpdated(itemId: String, timestamp: Long = System.currentTimeMillis())

    @Query(
        """
        DELETE FROM article_tags WHERE itemId = :itemId AND tag = :tag
        """
    )
    suspend fun deleteArticleTag(itemId: String, tag: String)

    @Query("""
        SELECT tag FROM article_tags WHERE itemId = :itemId
    """)
    suspend fun getArticleTags(itemId: String): List<String>

    @Upsert
    suspend fun insertArticleAuthors(items: List<ArticleAuthors>)

    @Upsert
    suspend fun insertDomainMetadata(item: DomainMetadata)

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query(
        """
        SELECT article.itemId, article.title,
        COALESCE(article.url, article.givenUrl) AS url,
        article.image,
        CASE WHEN article.favorite = '1' OR article.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN article.timeRead IS NOT NULL AND article.timeRead > 0 THEN 1 ELSE 0 END AS isRead
        FROM article
        JOIN article_fts ON article.itemId = article_fts.itemId
        WHERE article_fts MATCH :query
        """
    )
    suspend fun searchArticles(query: String): List<ArticleItem>

    @SuppressWarnings(RoomWarnings.Companion.QUERY_MISMATCH)
    @Query(
        """
        SELECT article.itemId, article.title,
        COALESCE(article.url, article.givenUrl) AS url,
        article.image,
        CASE WHEN article.favorite = '1' OR article.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN article.timeRead IS NOT NULL AND article.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        snippet(article_fts) AS snippet,
        matchinfo(article_fts) AS matchInfo
        FROM article
        JOIN article_fts ON article.itemId = article_fts.itemId
        WHERE article_fts MATCH :query
        """
    )
    suspend fun searchArticlesWithMatchInfo(query: String): List<ArticleWithMatchInfo>

    @Query("""
        SELECT * FROM article
        WHERE articleId != "0"
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLatestArticle(): Article?

    @Query("""
        SELECT * FROM article
        WHERE text IS NULL
        ORDER BY timeUpdated DESC
        LIMIT 10
        OFFSET :offset
    """
    )
    fun getPocketsWithoutText(offset: Int): List<Article>

    @Query(
        """
        SELECT timeUpdated FROM article
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLastUpdatedArticleTime(): Long

    @Query("""
        SELECT COUNT(*) FROM article
        """)
    fun countArticle(): Int

    @Query("""
        UPDATE article
        SET timeAdded = :time, timeUpdated = :time
        WHERE timeAdded = 0 AND timeUpdated = 0
        """)
    suspend fun backfillZeroTimestamps(time: Long)

//    @Upsert
//    suspend fun upsertArticleSummary(pocketSummary: PocketSummary)
//
//    @Upsert
//    suspend fun upsertArticleSummaries(pocketSummaries: List<PocketSummary>)
//
//    @Query("SELECT * FROM pocketsummary WHERE id = :itemId")
//    suspend fun getSummary(itemId: String): PocketSummary?

    /**
     * Upserts an article into the database.
     *
     * This function attempts to find an existing article based on the `givenUrl` or `url` of the `newArticle`.
     * If an existing article is found, it updates the `timeUpdated` field with the `timeAdded` value from the `newArticle`.
     * If no existing article is found, the function does nothing.
     *
     * This operation is performed within a transaction to ensure data consistency.
     *
     * @param newArticle The new article data to upsert.
     */
    @Transaction
    suspend fun upsertNewArticle(newArticle: Article): String {
//        Timber.d("insert article: ${newArticle.itemId}")
        var existingArticle: Article? = null
        if (newArticle.givenUrl != null) {
//            Timber.d("givenUrl is not null, checking for existing article")
            existingArticle = getArticleByUrl(newArticle.givenUrl)
//            Timber.d("is there an existingArticle: ${existingArticle?.itemId}")
        }
        if (existingArticle == null && newArticle.url != null) {
//            Timber.d("url is not null and existing article is still null, checking for existing article")
            existingArticle = getArticleByUrl(newArticle.url)
//            Timber.d("is there an existingArticle: ${existingArticle?.itemId}")
        }
        if (existingArticle != null) {
            val normalizedFavorite = when {
                existingArticle.favorite == "1" || existingArticle.timeFavorited > 0 -> "1"
                newArticle.favorite == "1" || newArticle.timeFavorited > 0 -> "1"
                newArticle.favorite == "0" -> "0"
                !newArticle.favorite.isNullOrBlank() -> newArticle.favorite
                else -> existingArticle.favorite
            }

            upsertArticle(
                newArticle.copy(
                    itemId = existingArticle.itemId,
                    articleId = existingArticle.articleId,
                    resolvedId = existingArticle.resolvedId,
                    timeUpdated = newArticle.timeAdded,
                    timeAdded = existingArticle.timeAdded, //TODO: this is not right
                    title = newArticle.title.ifBlank { existingArticle.title },
                    givenTitle = newArticle.givenTitle.ifBlank { existingArticle.givenTitle },
                    url = newArticle.url ?: existingArticle.url,
                    givenUrl = newArticle.givenUrl ?: existingArticle.givenUrl,
                    favorite = normalizedFavorite,
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
//                existingArticle.copy(
//                    timeUpdated = newArticle.timeAdded,
//                    timeAdded = newArticle.timeAdded
//                )
            )
            return existingArticle.itemId
        } else {
//            Timber.d("existingArticle is null, inserting article")
            upsertArticle(newArticle)
            return newArticle.itemId
        }
    }
}
