package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Query
import androidx.room.RewriteQueriesToDropUnusedColumns
import androidx.room.RoomWarnings
import androidx.room.Transaction
import androidx.room.Upsert
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.DomainMetadata
import com.jayteealao.trails.network.PocketAuthors
import com.jayteealao.trails.network.PocketImages
import com.jayteealao.trails.network.PocketTags
import com.jayteealao.trails.network.PocketVideos
import timber.log.Timber

@Dao
interface PocketDao {

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url,
        CASE WHEN favorite = '1' THEN 1 ELSE 0 END AS favorite
        FROM pocketarticle
        ORDER BY timeAdded DESC
        """
    )
    fun getArticles(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM pocketarticle AS art
        LEFT JOIN pockettags AS tag ON art.itemId = tag.itemId
        GROUP BY art.itemId
        ORDER BY art.timeAdded DESC
    """)
    fun getArticlesWithTags(): PagingSource<Int, ArticleItem>

    @Query("SELECT * FROM pocketarticle WHERE itemId = :itemId")
    fun getArticleById(itemId: String): PocketArticle?

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @RewriteQueriesToDropUnusedColumns
    @Query(
        """
        SELECT itemId, title, COALESCE(url, givenUrl) AS url, image,
        CASE WHEN favorite = '1' THEN 1 ELSE 0 END AS favorite,
        excerpt AS snippet
        FROM pocketarticle
        WHERE itemId IN (:ids)
        """
    )
    fun getArticlesByIds(ids: List<String>): List<ArticleItem>

    @Query("SELECT * FROM pocketarticle WHERE url = :url OR givenUrl = :url")
    fun getArticleByUrl(url: String): PocketArticle?

    @Query("SELECT * FROM pocketarticle WHERE resolved = 0 OR resolved = 3")
    suspend fun getUnresolvedArticles(): List<PocketArticle>

    @Query(
        """
        UPDATE pocketarticle
        SET timeToRead = :timeToRead, listenDurationEstimate = :listenDurationEstimate, wordCount = :wordCount, resolved = 3
        WHERE itemId = :itemId
    """)
    suspend fun updateArticleMetrics(itemId: String, timeToRead: Int, listenDurationEstimate: Int, wordCount: Int)

    @Query("SELECT * FROM pocketarticle WHERE resolved = 2 OR resolved = 1")
    suspend fun getNonMetricsArticles(): List<PocketArticle>

    @Query("SELECT * FROM pocketarticle WHERE text = '0' OR text = '1'")
    suspend fun getTextEqualsZeroOrOne(): List<PocketArticle>

    @Query("UPDATE pocketarticle SET text = :text, resolved = 2 WHERE itemId = :itemId")
    suspend fun updateText(itemId: String, text: String?)

    @Query("UPDATE pocketarticle SET resolved = :resolved WHERE itemId IN (:itemIds)")
    suspend fun updateResolved(itemIds: List<String>, resolved: Int)

    @Query("""
            UPDATE pocketarticle
            SET title = :title, url = :url, image = :image, hasImage = :hasImage, excerpt = :excerpt
            WHERE itemId = :itemId
            """)
    suspend fun updateUnfurledDetails(itemId: String, title: String, url: String, image: String?, hasImage: Boolean, excerpt: String)

    @Upsert
    suspend fun insertPocket(item: PocketArticle)

    @Upsert
    suspend fun insertPockets(items: List<PocketArticle>)

    @Upsert
    suspend fun insertPocketImages(items: List<PocketImages>)

    @Upsert
    suspend fun insertPocketVideos(item: List<PocketVideos>)

    @Upsert
    suspend fun insertPocketTags(items: List<PocketTags>)

    @Query("""
        SELECT tag FROM pockettags WHERE itemId = :itemId
    """)
    suspend fun getPocketTags(itemId: String): List<String>

    @Upsert
    suspend fun insertPocketAuthors(items: List<PocketAuthors>)

    @Upsert
    suspend fun insertDomainMetadata(item: DomainMetadata)
    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query(
        """
        SELECT pocketarticle.itemId, pocketarticle.title,
        COALESCE(pocketarticle.url, pocketarticle.givenUrl) AS url,
        pocketarticle.image,
        CASE WHEN pocketarticle.favorite = '1' THEN 1 ELSE 0 END AS favorite
        FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
        """
    )
    suspend fun searchPockets(query: String): List<ArticleItem>

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query(
        """
        SELECT pocketarticle.itemId, pocketarticle.title,
        COALESCE(pocketarticle.url, pocketarticle.givenUrl) AS url,
        pocketarticle.image,
        CASE WHEN pocketarticle.favorite = '1' THEN 1 ELSE 0 END AS favorite,
        snippet(pocketarticle_fts) AS snippet,
        matchinfo(pocketarticle_fts) AS matchInfo
        FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
        """
    )
    suspend fun searchPocketsWithMatchInfo(query: String): List<PocketWithMatchInfo>

    @Query("""
        SELECT * FROM pocketarticle
        WHERE pocketId != "0"
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLatestArticle(): PocketArticle?

    @Query("""
        SELECT * FROM pocketarticle
        WHERE text IS NULL
        ORDER BY timeUpdated DESC
        LIMIT 10
        OFFSET :offset
    """
    )
    fun getPocketsWithoutText(offset: Int): List<PocketArticle>

    @Query(
        """
        SELECT timeUpdated FROM pocketarticle
        ORDER BY timeAdded DESC
        LIMIT 1
    """
    )
    fun getLastUpdatedArticleTime(): Long

    @Query("""
        SELECT COUNT(*) FROM pocketarticle
        """)
    fun countArticle(): Int

    @Query("""
        UPDATE pocketarticle
        SET timeAdded = :time, timeUpdated = :time
        WHERE timeAdded = 0 AND timeUpdated = 0
        """)
    suspend fun backfillZeroTimestamps(time: Long)

//    @Upsert
//    suspend fun insertPocketSummary(pocketSummary: PocketSummary)
//
//    @Upsert
//    suspend fun insertPocketSummaries(pocketSummaries: List<PocketSummary>)
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
    suspend fun upsertArticle(newArticle: PocketArticle): String {
        Timber.d("insert article: ${newArticle.itemId}")
        var existingArticle: PocketArticle? = null
        if (newArticle.givenUrl != null) {
            Timber.d("givenUrl is not null, checking for existing article")
            existingArticle = getArticleByUrl(newArticle.givenUrl)
            Timber.d("is there an existingArticle: ${existingArticle?.itemId}")
        }
        if (existingArticle == null && newArticle.url != null) {
            Timber.d("url is not null and existing article is still null, checking for existing article")
            existingArticle = getArticleByUrl(newArticle.url)
            Timber.d("is there an existingArticle: ${existingArticle?.itemId}")
        }
        if (existingArticle != null) {
            Timber.d("existingArticle is not null, updating article")
            insertPocket(
                newArticle.copy(
                    itemId = existingArticle.itemId,
                    pocketId = existingArticle.pocketId,
                    resolvedId = existingArticle.resolvedId,
                    timeUpdated = newArticle.timeAdded,
                    timeAdded = newArticle.timeAdded, //TODO: this is not right
                    title = if (newArticle.title.isBlank()) existingArticle.title else newArticle.title,
                    givenTitle = if (newArticle.givenTitle.isBlank()) existingArticle.givenTitle else newArticle.givenTitle,
                    url = newArticle.url ?: existingArticle.url,
                    givenUrl = newArticle.givenUrl ?: existingArticle.givenUrl,
                    favorite = if (newArticle.favorite.isNullOrBlank()) existingArticle.favorite else newArticle.favorite,
                    status = if (newArticle.status.isBlank()) existingArticle.status else newArticle.status,
                    image = newArticle.image ?: existingArticle.image,
                    hasImage = if (newArticle.hasImage == false) existingArticle.hasImage else newArticle.hasImage,
                    hasVideo = if (newArticle.hasVideo == false) existingArticle.hasVideo else newArticle.hasVideo,
                    hasAudio = if (newArticle.hasAudio == false) existingArticle.hasAudio else newArticle.hasAudio,
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
            Timber.d("existingArticle is null, inserting article")
            insertPocket(newArticle)
            return newArticle.itemId
        }
    }
}
