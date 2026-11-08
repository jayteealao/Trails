# Canonical schema: `articles/{itemId}.metadata`

This is the wire-format source of truth for the metadata block that Warg
writes to Firestore and Trails reads. It is enforced by
`shared-types/check-drift.ts`, which runs in CI for both Android and Warg
workflows.

## Firestore field names (snake_case)

These are the literal Firestore document field names that both stacks
agree on. **Renaming any of these requires updating both consumers in the
same commit.**

| Field          | Type             | Producer (Warg) | Consumer (Trails) | Notes |
| -------------- | ---------------- | --------------- | ----------------- | ----- |
| `title`        | string           | required        | optional read     |       |
| `excerpt`      | string           | required        | optional read     |       |
| `byline`       | string           | required        | optional read     |       |
| `word_count`   | number (int)     | required        | optional read     | Kotlin maps to camelCase `wordCount` |
| `published_time` | string \| null | required        | not consumed yet  | Warg-only for now |
| `site_name`    | string \| null   | required        | not consumed yet  | Warg-only for now |
| `lead_image`   | string \| null   | required        | optional read     | Page `og:image` (or `og:image:url`), resolved against the page URL; `null` when missing, invalid or not http(s). Docs written before this field have no key. Trails stores it as the article's lead-image row and uses it as the article image. |

## Articles document fields

The other field names the cloud functions write on the shared article
`articles/{id}` and on the user article `users/{uid}/articles/{id}`. Every
server write of these two documents goes through the writer module
[`warg/packages/article-writer`](../warg/packages/article-writer), whose
tests check that each patch it builds uses only the names listed here. A
dotted name is a field of a map (`stats.total_saves` is `total_saves` in
`stats`). The write kinds are the writer functions that set the field.

| Field | Lives on | Write kinds | Notes |
| ----- | -------- | ----------- | ----- |
| `item_id` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing | the document id |
| `url` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing | |
| `normalizedUrl` | `articles/{id}` | createSharedArticleInTransaction | the link lookup key |
| `domain` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing | |
| `created_at` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields | |
| `updated_at` | `articles/{id}` | bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing | |
| `status` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, markSharedArticleArchiveStarted, markSharedArticleFailed, markSharedArticleProcessing | `pending`, `processing`, `failed` |
| `archives` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle | written empty |
| `pocket` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields | |
| `pocket.favorite` | `articles/{id}` | as `pocket` | |
| `pocket.resolved_id` | `articles/{id}` | as `pocket` | |
| `pocket.status` | `articles/{id}` | as `pocket` | |
| `pocket.time_added` | `articles/{id}` | as `pocket` | |
| `pocket.time_read` | `articles/{id}` | as `pocket` | |
| `stats` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields | |
| `stats.last_accessed` | `articles/{id}` | as `stats` | |
| `stats.total_saves` | `articles/{id}` | as `stats`, countSharedArticleSaveInTransaction | |
| `stats.total_views` | `articles/{id}` | as `stats` | |
| `stats.last_saved_at` | `articles/{id}` | countSharedArticleSaveInTransaction | |
| `warg_request_id` | `articles/{id}` | markSharedArticleArchiveStarted, markSharedArticleProcessing | |
| `processing_started_at` | `articles/{id}` | markSharedArticleArchiveStarted, markSharedArticleProcessing | |
| `error` | `articles/{id}` | markSharedArticleFailed | |
| `failed_at` | `articles/{id}` | markSharedArticleFailed | |
| `canonicalId` | `users/{uid}/articles/{id}` | linkUserArticleInTransaction | server-owned link, see `MarkerSchema.md` |
| `resolvedId` | `users/{uid}/articles/{id}` | linkUserArticleInTransaction, setUserArticleResolvedLink | |
| `archival_triggered` | `users/{uid}/articles/{id}` | markUserArticleArchivalTriggered, setUserArticleResolvedLink | |
| `error` | `users/{uid}/articles/{id}` | recordUserArticleError | |
| `error_at` | `users/{uid}/articles/{id}` | recordUserArticleError | |

## Producer

Warg writes these fields via `FinalizeRequest.metadata` defined in
[`warg/cloud-functions/archive-gateway/src/types.ts`](../warg/cloud-functions/archive-gateway/src/types.ts).
The Firestore document shape is also typed there as `ArticleDocument`.

## Consumer

Trails reads five of these fields (`title`, `excerpt`, `byline`, `word_count`
and `lead_image`) via `WargMetadata` defined in
[`android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt`](../android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt).
Trails treats all of them as nullable in case the Warg pipeline hasn't
finalized yet.

## Adding a new field

1. Add a row to the table above.
2. Add it to `FinalizeRequest.metadata` and `ArticleDocument.metadata` in
   `warg/cloud-functions/archive-gateway/src/types.ts`.
3. Optionally add it to Trails' `WargMetadata` data class if Trails needs
   to surface it.
4. Update `firebase/firestore.rules` if the field has a validation rule.
5. Run `node --experimental-strip-types shared-types/check-drift.ts`
   locally to confirm.

A new field of the shared article or the user article (outside `metadata`)
gets a row in "Articles document fields" above and its name in the field
lists of `warg/packages/article-writer/src/fields.ts`, in the same commit.
