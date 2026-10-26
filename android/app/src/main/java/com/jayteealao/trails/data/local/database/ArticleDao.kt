package com.jayteealao.trails.data.local.database

import androidx.paging.PagingSource
import androidx.room3.Dao
import androidx.room3.DaoReturnTypeConverters
import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.Query
import androidx.room3.RewriteQueriesToDropUnusedColumns
import androidx.room3.RoomWarnings
import androidx.room3.Transaction
import androidx.room3.Upsert
import androidx.room3.paging.PagingSourceDaoReturnTypeConverter
import com.jayteealao.trails.data.models.ArticleItem
import com.jayteealao.trails.network.ArticleAuthors
import com.jayteealao.trails.network.ArticleData
import com.jayteealao.trails.network.ArticleImages
import com.jayteealao.trails.network.ArticleTags
import com.jayteealao.trails.network.ArticleVideos
import com.jayteealao.trails.network.DomainMetadata
import kotlinx.coroutines.flow.Flow

/** Failed push runs after which the sync skips an article until the person retries it. */
const val MAX_SYNC_FAILURES = 3

@Dao
@DaoReturnTypeConverters(PagingSourceDaoReturnTypeConverter::class)
interface ArticleDao {

    @Query("SELECT COUNT(*) FROM article WHERE deleted_at IS NULL")
    suspend fun countAllArticles(): Int

    /**
     * Keyset page of the rows a push run sends, changed up to [until]: up to [limit] rows
     * after ([afterTimeUpdated], [afterItemId]) in (timeUpdated, itemId) order. A [since] of
     * 0 or more selects only rows not backed up at their current version; a negative one
     * selects every row. Includes deleted rows (a deletion is pushed as `deletedAt`); skips
     * rows at MAX_SYNC_FAILURES.
     */
    @Query(ArticleSql.CHANGED_SINCE_KEYSET)
    suspend fun getArticlesModifiedSinceKeyset(
        since: Long,
        until: Long,
        afterTimeUpdated: Long,
        afterItemId: String,
        limit: Int,
    ): List<Article>

    /** Rows [getArticlesModifiedSinceKeyset] selects, deleted rows included, skipped rows left out. */
    @Query(ArticleSql.COUNT_CHANGED_SINCE)
    suspend fun countArticlesModifiedSince(since: Long, until: Long): Int

    /** Rows changed in the window (since, until], sent or not, skipped rows left out. */
    @Query(ArticleSql.COUNT_CHANGED_IN_WINDOW)
    suspend fun countArticlesChangedInWindow(since: Long, until: Long): Int

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(ArticleSql.MAIN_LIST)
    fun getArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(ArticleSql.FAVORITE_LIST)
    fun getFavoriteArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(ArticleSql.ARCHIVE_LIST)
    fun getArchivedArticlesWithTags(): PagingSource<Int, ArticleItem>

    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(ArticleSql.TAG_LIST_BY_TAG)
    fun getArticlesWithTag(tag: String): PagingSource<Int, ArticleItem>

    /**
     * Tags with at least one non-deleted article, matched by itemId or resolvedId, so the
     * list matches [getArticlesWithTag]. Reading `article` also makes the Flow re-emit on deletes.
     */
    @Query(ArticleSql.ALL_TAGS)
    fun getAllTags(): Flow<List<String>>

    @Query("SELECT * FROM article WHERE itemId = :itemId")
    suspend fun getArticleById(itemId: String): Article?

    /**
     * Live articles added after [since] that have neither the Warg lead-image row nor the
     * byline row yet, newest first, at most [limit]. The background metadata pass reads them.
     */
    @Query(
        """
        SELECT itemId FROM article AS a
        WHERE a.deleted_at IS NULL AND a.timeAdded > :since
          AND NOT EXISTS (SELECT 1 FROM article_images AS i WHERE i.itemId = a.itemId AND i.imageId = 'lead')
          AND NOT EXISTS (SELECT 1 FROM article_authors AS au WHERE au.authorId = a.itemId || ':byline')
        ORDER BY a.timeAdded DESC
        LIMIT :limit
        """
    )
    suspend fun getRecentArticlesWithoutWargRows(since: Long, limit: Int): List<String>

    /** Every local row of [itemIds], deleted rows included, in one IN-query. */
    @Query("SELECT * FROM article WHERE itemId IN (:itemIds)")
    suspend fun getArticlesWithIds(itemIds: List<String>): List<Article>

    /** Look up an article whose resolvedId matches [resolvedId] (used by self-heal). */
    @Query(ArticleSql.BY_RESOLVED_ID)
    suspend fun getArticleByResolvedId(resolvedId: String): Article?

    /** Articles with the given ids; excludes deleted articles. */
    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @RewriteQueriesToDropUnusedColumns
    @Query(
        """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        art.excerpt AS snippet,
        GROUP_CONCAT(tag.tag) AS tagsString
        FROM article AS art
        LEFT JOIN article_tags AS tag ON art.itemId = tag.itemId
        WHERE art.itemId IN (:ids) AND art.deleted_at IS NULL
        GROUP BY art.itemId
        """
    )
    suspend fun getArticlesByIds(ids: List<String>): List<ArticleItem>

    @Query("SELECT * FROM article WHERE url = :url OR givenUrl = :url")
    suspend fun getArticleByUrl(url: String): Article?

    @Query(ArticleSql.BY_NORMALIZED_URL)
    suspend fun getArticleByNormalizedUrl(normalizedUrl: String): Article?

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

    @Query("""
            UPDATE article
            SET title = :title, url = :url, image = :image, hasImage = :hasImage, excerpt = :excerpt,
                normalized_url = :normalizedUrl
            WHERE itemId = :itemId
            """)
    suspend fun updateUnfurledDetails(itemId: String, title: String, url: String, image: String?, hasImage: Boolean, excerpt: String, normalizedUrl: String)

    @Query("UPDATE article SET excerpt = :excerpt WHERE itemId = :itemId")
    suspend fun updateExcerpt(itemId: String, excerpt: String)

    @Query("UPDATE article SET text = :text, text_source = :source, resolved = 2 WHERE itemId = :itemId")
    suspend fun updateTextWithSource(itemId: String, text: String?, source: String)

    @Query("UPDATE article SET image = :image, hasImage = 1 WHERE itemId = :itemId")
    suspend fun updateImage(itemId: String, image: String)

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
        SET timeRead = CASE WHEN :isRead THEN :readTimestamp ELSE NULL END,
            timeUpdated = :currentTime
        WHERE itemId = :itemId
        """
    )
    suspend fun updateReadStatus(itemId: String, isRead: Boolean, readTimestamp: Long?, currentTime: Long)

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

    /**
     * Delete all tags for [itemId] in a single SQL statement (efficiency-3).
     * Replaces the per-tag loop in conflict resolution: N DAO calls → 1 DAO call.
     *
     * NOTE: The delete-then-insert pattern (this method followed by [insertArticleTags])
     * is not wrapped in a Room [@Transaction]. There is a brief window where an article
     * has no tags between delete and insert; this matches the prior per-tag-delete + insert
     * behaviour. The sync path is background-only and not user-visible, so the window is
     * acceptable.
     */
    @Query("DELETE FROM article_tags WHERE itemId = :itemId")
    suspend fun deleteAllTagsForArticle(itemId: String)

    @Query("""
        SELECT tag FROM article_tags WHERE itemId = :itemId
    """)
    suspend fun getArticleTags(itemId: String): List<String>

    /**
     * Bulk-fetch tags for a list of article IDs in a single SQL statement.
     *
     * Replaces the per-article [getArticleTags] loop in [syncLocalChanges]:
     * N serial DAO reads → 1 IN-query per chunk (efficiency fix, review CR-1).
     *
     * Usage:
     * ```kotlin
     * val allTags = articleDao.getTagsForArticles(chunk.map { it.itemId })
     * val chunkTagsMap = allTags.groupBy { it.itemId }
     * ```
     */
    @Query("SELECT * FROM article_tags WHERE itemId IN (:itemIds)")
    suspend fun getTagsForArticles(itemIds: List<String>): List<ArticleTags>

    /**
     * Rows whose current version Firestore has not confirmed: unsent edits, unsent
     * deletes and rows skipped after MAX_SYNC_FAILURES. Restore and push stamp the
     * article's sync_state row, so their rows are not counted. A deleted row that was never
     * backed up counts until the never-backed-up sweep sends its deletion.
     */
    @Query(ArticleSql.COUNT_UNSYNCED)
    suspend fun countUnsyncedChanges(): Int

    @Query("DELETE FROM article_tags")
    suspend fun wipeArticleTags()

    @Query("DELETE FROM article_images")
    suspend fun wipeArticleImages()

    @Query("DELETE FROM article_videos")
    suspend fun wipeArticleVideos()

    @Query("DELETE FROM article_authors")
    suspend fun wipeArticleAuthors()

    @Query("DELETE FROM DomainMetadata")
    suspend fun wipeDomainMetadata()

    @Query("DELETE FROM local_archive")
    suspend fun wipeLocalArchives()

    @Query("DELETE FROM article")
    suspend fun wipeArticles()

    @Query("DELETE FROM sync_state")
    suspend fun wipeSyncState()

    /**
     * Delete every table in one transaction. article_fts empties through Room's
     * content triggers on article. A new table gets its delete here.
     */
    @Transaction
    suspend fun wipeAllLocalData() {
        wipeSyncState()
        wipeArticleTags()
        wipeArticleImages()
        wipeArticleVideos()
        wipeArticleAuthors()
        wipeDomainMetadata()
        wipeLocalArchives()
        wipeArticles()
    }

    @Upsert
    suspend fun insertArticleAuthors(items: List<ArticleAuthors>)

    /** Image rows of [itemIds] in one IN-query, as [getTagsForArticles] does for tags. */
    @Query(ArticleSql.IMAGES_FOR_ARTICLES)
    suspend fun getImagesForArticles(itemIds: List<String>): List<ArticleImages>

    /** Author rows of [itemIds] in one IN-query. */
    @Query(ArticleSql.AUTHORS_FOR_ARTICLES)
    suspend fun getAuthorsForArticles(itemIds: List<String>): List<ArticleAuthors>

    /** Video rows of [itemIds] in one IN-query. */
    @Query(ArticleSql.VIDEOS_FOR_ARTICLES)
    suspend fun getVideosForArticles(itemIds: List<String>): List<ArticleVideos>

    /**
     * Upsert image, author and video rows in one transaction. The restore path uses it:
     * it does not touch the article, so a restore never causes a push back.
     */
    @Transaction
    suspend fun insertArticleRows(
        images: List<ArticleImages>,
        authors: List<ArticleAuthors>,
        videos: List<ArticleVideos> = emptyList(),
    ) {
        if (images.isNotEmpty()) insertArticleImages(images)
        if (authors.isNotEmpty()) insertArticleAuthors(authors)
        if (videos.isNotEmpty()) insertArticleVideos(videos)
    }

    /** Raise the article's `timeUpdated` to [now] (never lower it). */
    @Query("UPDATE article SET timeUpdated = MAX(timeUpdated, :now) WHERE itemId = :itemId")
    suspend fun touchArticle(itemId: String, now: Long)

    /**
     * Store image and author rows made on this device and raise the article's
     * `timeUpdated` to [now] in one transaction, so the next push sends the article
     * with its rows. Row ids must be unique per article: `article_authors` keys rows
     * by `authorId` alone.
     */
    @Transaction
    suspend fun addLocalArticleRows(
        itemId: String,
        images: List<ArticleImages>,
        authors: List<ArticleAuthors>,
        now: Long,
    ) {
        insertArticleRows(images, authors)
        touchArticle(itemId, now)
    }

    @Upsert
    suspend fun insertDomainMetadata(item: DomainMetadata)

    /**
     * Full-text search. [match] is an FTS5 match string from `FtsMatchQuery`; results come best
     * first by bm25, deleted articles are excluded, and at most [limit] rows return.
     */
    @SuppressWarnings(RoomWarnings.QUERY_MISMATCH)
    @Query(ArticleSql.SEARCH_RANKED)
    suspend fun searchArticlesRanked(match: String, limit: Int): List<ArticleItem>

    /**
     * Return articles that have never been successfully backed up to Firestore (no
     * [SyncState.backedUpAt], or no sync_state row), deleted ones included so their deletion
     * reaches Firestore, in (timeUpdated, itemId) order. Returns the first [limit] rows
     * only: the sweep stamps what it pushes, so the next call returns the next batch.
     * Skips rows that failed MAX_SYNC_FAILURES runs.
     */
    @Query(ArticleSql.NEVER_BACKED_UP)
    suspend fun getArticlesNeverBackedUp(limit: Int): List<Article>

    /**
     * Count of articles matching the [getArticlesNeverBackedUp] predicate — the
     * backlog the reconciliation sweep is about to drain. Skips rows that failed MAX_SYNC_FAILURES runs.
     */
    @Query(ArticleSql.COUNT_NEVER_BACKED_UP)
    suspend fun countArticlesNeverBackedUp(): Int

    /** The sync bookkeeping of [itemId]; null when the article was never stamped or struck. */
    @Query("SELECT * FROM sync_state WHERE itemId = :itemId")
    suspend fun getSyncState(itemId: String): SyncState?

    @Upsert
    suspend fun upsertSyncState(state: SyncState)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertSyncStatesIfAbsent(states: List<SyncState>)

    @Query("SELECT timeUpdated FROM article WHERE itemId = :itemId")
    suspend fun getTimeUpdated(itemId: String): Long?

    /**
     * Stamp a successful push of the version [pushedTimeUpdated]: it becomes the article's
     * backed-up stamp in sync_state, and the failed-push counter goes back to 0, only while
     * the row still has that version. An edit committed after the push read the row changed
     * `timeUpdated`, so the row stays unsynced and the next push sends the edit. Returns the
     * number of rows stamped (0 or 1). Writes only sync_state, so the search index is untouched.
     */
    @Transaction
    suspend fun markBackedUpIfUnchanged(itemId: String, pushedTimeUpdated: Long): Int {
        if (getTimeUpdated(itemId) != pushedTimeUpdated) return 0
        upsertSyncState(SyncState(itemId, pushedTimeUpdated, 0))
        return 1
    }

    @Query("UPDATE sync_state SET sync_failures = sync_failures + 1 WHERE itemId IN (:itemIds)")
    suspend fun bumpSyncFailures(itemIds: List<String>)

    /** Count one more failed push run for each of [itemIds]; writes only sync_state. */
    @Transaction
    suspend fun incrementSyncFailures(itemIds: List<String>) {
        insertSyncStatesIfAbsent(itemIds.map { SyncState(it) })
        bumpSyncFailures(itemIds)
    }

    /**
     * Record the outcome of one push in one transaction: stamp each [succeeded] row with the
     * version that was sent (itemId to the `timeUpdated` it was pushed with, see
     * [markBackedUpIfUnchanged]) and add a strike to the [failed] rows. The only place a
     * push stamps the backed-up time.
     */
    @Transaction
    suspend fun recordPushResults(succeeded: Map<String, Long>, failed: List<String>) {
        for ((itemId, pushedTimeUpdated) in succeeded) markBackedUpIfUnchanged(itemId, pushedTimeUpdated)
        if (failed.isNotEmpty()) incrementSyncFailures(failed)
    }

    /**
     * Articles the sync skips after MAX_SYNC_FAILURES failed runs, deleted rows included
     * (an unsent delete is an unsynced change).
     */
    @Query(ArticleSql.SYNC_FAILURE_COUNT)
    fun observeSyncFailureCount(): Flow<Int>

    @Query("UPDATE article SET timeUpdated = MAX(timeUpdated, :now) WHERE itemId IN (SELECT itemId FROM sync_state WHERE sync_failures >= $MAX_SYNC_FAILURES)")
    suspend fun touchSkippedArticles(now: Long)

    @Query("UPDATE sync_state SET sync_failures = 0 WHERE sync_failures >= $MAX_SYNC_FAILURES AND itemId IN (SELECT itemId FROM article)")
    suspend fun clearSkippedCounters(): Int

    /**
     * Clear the counter on every skipped article and raise its `timeUpdated` to [now],
     * so the next push sends it even though last sync has moved past it.
     * Returns the number of rows reset.
     */
    @Transaction
    suspend fun resetSyncFailures(now: Long): Int {
        touchSkippedArticles(now)
        return clearSkippedCounters()
    }

    /**
     * Store an article that came from Firestore and stamp it backed up at [stampedAt] with 0
     * strikes, in one transaction.
     */
    @Transaction
    suspend fun upsertRestoredArticle(article: Article, stampedAt: Long) {
        upsertArticle(article)
        upsertSyncState(SyncState(article.itemId, stampedAt, 0))
    }

    /**
     * Atomically upserts a batch of articles together with all their associated data
     * (images, videos, tags, authors, domain metadata) in a single database transaction.
     *
     * [articles] must be the already-transformed list (normalized URL, cleared
     * deletedAt/archivedAt, updated timeUpdated) that corresponds positionally to
     * [dataList]. The caller owns the Article transformation; this method owns the
     * atomicity guarantee.
     *
     * Mirrors the [@Transaction] pattern used by [upsertNewArticle].
     */
    @Transaction
    suspend fun upsertArticlesWithAssociatedData(
        articles: List<Article>,
        dataList: List<ArticleData>,
    ) {
        upsertArticles(articles)
        dataList.forEach { datum ->
            insertArticleImages(datum.images)
            insertArticleVideos(datum.videos)
            insertArticleTags(datum.tags)
            insertArticleAuthors(datum.authors)
            datum.domainMetadata?.let { insertDomainMetadata(it) }
        }
    }

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
        // Dedup via the dedicated normalized_url column
        val lookupUrl = newArticle.normalizedUrl
            ?: newArticle.url
            ?: newArticle.givenUrl

        val existingArticle = if (lookupUrl != null) {
            getArticleByNormalizedUrl(lookupUrl)
                ?: getArticleByUrl(lookupUrl) // Fallback for pre-migration rows
        } else null

        if (existingArticle != null) {
            val normalizedFavorite = when {
                existingArticle.favorite == "1" || existingArticle.timeFavorited > 0 -> "1"
                newArticle.favorite == "1" || newArticle.timeFavorited > 0 -> "1"
                newArticle.favorite == "0" -> "0"
                !newArticle.favorite.isNullOrBlank() -> newArticle.favorite
                else -> existingArticle.favorite
            }

            // The sync_state row is not touched, so a re-save keeps the stamp and the
            // counter; timeUpdated moves, so the push still sends it.
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
                    normalizedUrl = newArticle.normalizedUrl ?: existingArticle.normalizedUrl,
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
                    deletedAt = null,
                    archivedAt = null,
                )
            )
            return existingArticle.itemId
        } else {
            upsertArticle(newArticle)
            return newArticle.itemId
        }
    }
}
