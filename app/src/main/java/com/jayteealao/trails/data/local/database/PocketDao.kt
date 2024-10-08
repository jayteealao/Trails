package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import androidx.room.Dao
import androidx.room.Query
import androidx.room.RewriteQueriesToDropUnusedColumns
import androidx.room.RoomWarnings
import androidx.room.Upsert
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.data.models.PocketSummary
import com.jayteealao.trails.network.DomainMetadata
import com.jayteealao.trails.network.PocketAuthors
import com.jayteealao.trails.network.PocketImages
import com.jayteealao.trails.network.PocketTags
import com.jayteealao.trails.network.PocketVideos

@Dao
interface PocketDao {

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query("SELECT itemId, title, url FROM pocketarticle ORDER BY timeAdded DESC")
    fun getArticles(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query("""
        SELECT art.itemId, art.title, art.url,
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
    @Query("SELECT * FROM pocketarticle WHERE itemId IN (:ids)")
    fun getArticlesByIds(ids: List<String>): List<ArticleItem>

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
    @Query("""
        SELECT pocketarticle.itemId, pocketarticle.title, pocketarticle.url FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
    """)
    suspend fun searchPockets(query: String): List<ArticleItem>

    @SuppressWarnings(RoomWarnings.CURSOR_MISMATCH)
    @Query("""
        SELECT pocketarticle.itemId, pocketarticle.title, pocketarticle.url, snippet(pocketarticle_fts) as snippet, matchinfo(pocketarticle_fts) as matchInfo FROM pocketarticle
        JOIN pocketarticle_fts ON pocketarticle.itemId = pocketarticle_fts.itemId
        WHERE pocketarticle_fts MATCH :query
    """)
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
        ORDER BY timeUpdated DESC
        LIMIT 1
    """
    )
    fun getLastUpdatedArticleTime(): Long

    @Upsert
    suspend fun insertPocketSummary(pocketSummary: PocketSummary)

    @Upsert
    suspend fun insertPocketSummaries(pocketSummaries: List<PocketSummary>)

    @Query("SELECT * FROM pocketsummary WHERE id = :itemId")
    suspend fun getSummary(itemId: String): PocketSummary?

}
