package com.jayteealao.trails.data.local.database

/**
 * SQL of the list, tag, lookup and sync queries. [ArticleDao] declares each `@Query` with
 * one of these constants, and the query-plan tests run the same text through
 * `EXPLAIN QUERY PLAN` (`@Query` is not readable at run time, so the string is shared).
 * The index each query relies on is named on [Article], [com.jayteealao.trails.network.ArticleTags],
 * [com.jayteealao.trails.network.ArticleImages], [com.jayteealao.trails.network.ArticleAuthors] and
 * [com.jayteealao.trails.network.ArticleVideos].
 */
internal object ArticleSql {

    /** Library list: live, not archived, newest first. Tags come from a per-row subquery, so there is no GROUP BY. */
    const val MAIN_LIST = """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        (SELECT GROUP_CONCAT(t.tag) FROM article_tags AS t WHERE t.itemId = art.itemId) AS tagsString
        FROM article AS art
        WHERE art.archived_at IS NULL AND art.deleted_at IS NULL
        ORDER BY art.timeAdded DESC
    """

    /** Favourite list: live, not archived, latest favourite first. */
    const val FAVORITE_LIST = """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        (SELECT GROUP_CONCAT(t.tag) FROM article_tags AS t WHERE t.itemId = art.itemId) AS tagsString
        FROM article AS art
        WHERE art.timeFavorited > 0 AND art.archived_at IS NULL AND art.deleted_at IS NULL
        ORDER BY art.timeFavorited DESC, art.timeAdded DESC
    """

    /** Archive list: live and archived, latest archived first. */
    const val ARCHIVE_LIST = """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        (SELECT GROUP_CONCAT(t.tag) FROM article_tags AS t WHERE t.itemId = art.itemId) AS tagsString
        FROM article AS art
        WHERE art.archived_at IS NOT NULL AND art.deleted_at IS NULL
        ORDER BY art.archived_at DESC, art.timeAdded DESC
    """

    /**
     * Live articles carrying [tag] under their itemId or their resolvedId, newest first. The
     * two matches are two indexed lookups joined by UNION, not one OR join across columns.
     */
    const val TAG_LIST_BY_TAG = """
        SELECT art.itemId, art.title, COALESCE(art.url, art.givenUrl) AS url, art.image,
        CASE WHEN art.favorite = '1' OR art.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN art.timeRead IS NOT NULL AND art.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        (SELECT GROUP_CONCAT(t.tag) FROM article_tags AS t
            WHERE t.itemId IN (art.itemId, art.resolvedId)) AS tagsString
        FROM article AS art
        WHERE art.deleted_at IS NULL
          AND art.itemId IN (
            SELECT st.itemId FROM article_tags AS st WHERE st.tag = :tag
            UNION
            SELECT a.itemId FROM article_tags AS st JOIN article AS a ON a.resolvedId = st.itemId
            WHERE st.tag = :tag)
        ORDER BY art.timeAdded DESC
    """

    /**
     * Tags with at least one non-deleted article, matched by itemId or resolvedId, so the
     * list matches [TAG_LIST_BY_TAG]. Reading `article` also makes the Flow re-emit on deletes.
     */
    const val ALL_TAGS = """
        SELECT t.tag
        FROM article_tags AS t
        WHERE EXISTS (SELECT 1 FROM article AS a WHERE a.itemId = t.itemId AND a.deleted_at IS NULL)
           OR EXISTS (SELECT 1 FROM article AS a WHERE a.resolvedId = t.itemId AND a.deleted_at IS NULL)
        GROUP BY t.tag
        ORDER BY LOWER(t.tag)
    """

    /**
     * One keyset page of the push window (since, until]: rows after the cursor
     * (afterTimeUpdated, afterItemId) in (timeUpdated, itemId) order. Includes deleted rows
     * (a deletion is pushed as `deletedAt`); skips rows at MAX_SYNC_FAILURES. When since is
     * 0 or more it also skips rows whose current version is already backed up (an earlier run
     * that did not finish cleanly stamped them), so a retried run sends only what is still
     * unsent; a full push (since below 0, a first sync) sends every row. The cursor is a
     * key, not a row count: a row that changes or drops out during the run moves no later page.
     */
    const val CHANGED_SINCE_KEYSET = """
        SELECT * FROM article
        WHERE timeUpdated > :since AND timeUpdated <= :until
          AND sync_failures < $MAX_SYNC_FAILURES
          AND (:since < 0 OR backed_up_at IS NULL OR backed_up_at < timeUpdated)
          AND (timeUpdated, itemId) > (:afterTimeUpdated, :afterItemId)
        ORDER BY timeUpdated ASC, itemId ASC
        LIMIT :limit
    """

    /**
     * Rows in the push window (since, until] below MAX_SYNC_FAILURES, already backed-up rows
     * included: a window whose rows were all sent by an earlier run still counts, so the run
     * goes through the loop (which skips them) and records last sync when it succeeds.
     */
    const val COUNT_CHANGED_SINCE = """
        SELECT COUNT(*) FROM article
        WHERE timeUpdated > :since AND timeUpdated <= :until
          AND sync_failures < $MAX_SYNC_FAILURES
    """

    /**
     * The oldest never-backed-up rows, first page only: each sweep stamps the rows it
     * pushes, so they leave the predicate and the next first page is the next batch.
     * Deleted rows are included (sent as `deletedAt`): a row deleted before backups were
     * stamped is otherwise never sent and stays unsynced forever.
     */
    const val NEVER_BACKED_UP = """
        SELECT * FROM article
        WHERE backed_up_at IS NULL AND sync_failures < $MAX_SYNC_FAILURES
        ORDER BY timeAdded ASC
        LIMIT :limit
    """

    /** Rows matching [NEVER_BACKED_UP]'s predicate. */
    const val COUNT_NEVER_BACKED_UP =
        "SELECT COUNT(*) FROM article WHERE backed_up_at IS NULL AND sync_failures < $MAX_SYNC_FAILURES"

    const val BY_RESOLVED_ID = "SELECT * FROM article WHERE resolvedId = :resolvedId ORDER BY timeAdded DESC LIMIT 1"

    /**
     * Search: the live articles whose title or text matches [match] (an FTS5 match string from
     * `FtsMatchQuery`), best first by bm25 (lower is better), at most [limit]. The index reaches
     * `article` by rowid. The snippet marks matched words with `<b>` and `</b>`, 15 tokens from
     * the best column, as the result row shows them.
     */
    const val SEARCH_RANKED = """
        SELECT article.itemId, article.title,
        COALESCE(article.url, article.givenUrl) AS url,
        article.image,
        CASE WHEN article.favorite = '1' OR article.timeFavorited > 0 THEN 1 ELSE 0 END AS favorite,
        CASE WHEN article.timeRead IS NOT NULL AND article.timeRead > 0 THEN 1 ELSE 0 END AS isRead,
        snippet(article_fts, -1, '<b>', '</b>', '<b>...</b>', 15) AS snippet
        FROM article_fts
        JOIN article ON article.rowid = article_fts.rowid
        WHERE article_fts MATCH :match
          AND article.deleted_at IS NULL
        ORDER BY bm25(article_fts)
        LIMIT :limit
    """

    const val BY_NORMALIZED_URL = "SELECT * FROM article WHERE normalized_url = :normalizedUrl LIMIT 1"

    /** Image rows of several articles; the sync push and restore read them by itemId. */
    const val IMAGES_FOR_ARTICLES = "SELECT * FROM article_images WHERE itemId IN (:itemIds)"

    /** Author rows of several articles, read as [IMAGES_FOR_ARTICLES] reads images. */
    const val AUTHORS_FOR_ARTICLES = "SELECT * FROM article_authors WHERE itemId IN (:itemIds)"

    /** Video rows of several articles, read as [IMAGES_FOR_ARTICLES] reads images. */
    const val VIDEOS_FOR_ARTICLES = "SELECT * FROM article_videos WHERE itemId IN (:itemIds)"
}
