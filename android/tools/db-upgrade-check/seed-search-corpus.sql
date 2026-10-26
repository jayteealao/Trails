-- A search corpus seeded into the database of a version 10 build on a device.
-- 150 live articles with "lantern" in the text, 20 live articles with both "harbor" and
-- "lantern" in the text, and 10 deleted articles with "harbor" in the title. A search for
-- the two words matches 170 live articles, so the app shows its limit of 100.
-- Every row is stamped as backed up (backed_up_at = timeUpdated), so no sync pushes it.
-- The article_fts triggers that the app created index every row as it is inserted.
BEGIN;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 180),
rows AS (
  SELECT
    i,
    CASE
      WHEN i <= 150 THEN printf('search-lantern-%03d', i)
      WHEN i <= 170 THEN printf('search-both-%03d', i - 150)
      ELSE printf('search-deleted-%03d', i - 170)
    END AS itemId,
    CASE
      WHEN i <= 150 THEN printf('Evening walk notes %d', i)
      WHEN i <= 170 THEN printf('Quayside walk notes %d', i - 150)
      ELSE printf('Harbor survey %d', i - 170)
    END AS title,
    CASE
      -- A different number of filler words per row gives every row its own bm25 score,
      -- so the best-first order has no ties.
      WHEN i <= 150 THEN 'A lantern hung by the gate. ' || replace(hex(zeroblob(20 + i)), '00', 'hedge ')
      WHEN i <= 170 THEN 'The harbor wall held a lantern for each boat. ' || replace(hex(zeroblob(i - 150)), '00', 'quay ')
      ELSE 'Notes on the harbor and its tides.'
    END AS body,
    1770000000000 + i * 1000 AS t
  FROM n
)
INSERT INTO article (itemId, title, givenTitle, url, givenUrl, wordCount, status, hasImage, hasVideo, hasAudio,
  sortId, timeAdded, timeUpdated, timeFavorited, listenDurationEstimate, text, text_source, backed_up_at, deleted_at)
SELECT itemId, title, title, 'https://example.com/' || itemId, 'https://example.com/' || itemId, 100, '0', 0, 0, 0,
  i, t, t, 0, 0, body, 'seed', t, CASE WHEN i > 170 THEN t ELSE NULL END
FROM rows;
COMMIT;
