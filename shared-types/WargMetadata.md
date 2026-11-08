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
| `item_id` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing, upsertSharedArticleForBackfill, journalSharedArticleUploads | the document id |
| `url` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing, upsertSharedArticleForBackfill, journalSharedArticleUploads | |
| `normalizedUrl` | `articles/{id}` | createSharedArticleInTransaction, setSharedArticleNormalizedUrlInBulk | the link lookup key |
| `domain` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing, upsertSharedArticleForBackfill, journalSharedArticleUploads | |
| `created_at` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, upsertSharedArticleForBackfill, journalSharedArticleUploads | |
| `updated_at` | `articles/{id}` | bootstrapSharedArticle, backfillSharedArticleBaseFields, markSharedArticleProcessing, upsertSharedArticleForBackfill, markSharedArticleBackfillBegun, recordSharedArticleBackfillFailure, settleStuckSharedArticle, journalSharedArticleUploads, finalizeSharedArticleArchives | |
| `status` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, markSharedArticleArchiveStarted, markSharedArticleFailed, markSharedArticleProcessing, setSharedArticleDerivedStatus | `pending`, `processing`, `failed`; the status trigger writes the derived value |
| `archives` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, upsertSharedArticleForBackfill, recordSharedArticleBackfillFailure, settleStuckSharedArticle, journalSharedArticleUploads | written empty on create; the archive gateway writes one entry per stored artifact kind with journalSharedArticleUploads (merged, `uploading`) and finalizeSharedArticleArchives (each entry replaced by its dotted name, `success`), and copySharedArticleArchiveInBulk copies one whole `archives.<archive key>` entry from a merged duplicate |
| `archives.gateway_begin` | `articles/{id}` | recordSharedArticleBackfillFailure | the failed archive start of the backfill |
| `archives.gateway_begin.status` | `articles/{id}` | as `archives.gateway_begin` | `failed` |
| `archives.gateway_begin.error` | `articles/{id}` | as `archives.gateway_begin` | |
| `archives.gateway_begin.created_at` | `articles/{id}` | as `archives.gateway_begin` | an ISO string |
| `archives.workflow_settlement` | `articles/{id}` | settleStuckSharedArticle | a batch item that never finished |
| `archives.workflow_settlement.status` | `articles/{id}` | as `archives.workflow_settlement` | `stuck` |
| `archives.workflow_settlement.error` | `articles/{id}` | as `archives.workflow_settlement` | |
| `archives.workflow_settlement.created_at` | `articles/{id}` | as `archives.workflow_settlement` | an ISO string |
| `archives.singlefile` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.singlefile.status` | `articles/{id}` | as `archives.singlefile` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.singlefile.gcs_path` | `articles/{id}` | as `archives.singlefile` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.singlefile.gcs_bucket` | `articles/{id}` | as `archives.singlefile` |  |
| `archives.singlefile.compressed_size` | `articles/{id}` | as `archives.singlefile` | written on finalize |
| `archives.singlefile.compression_ratio` | `articles/{id}` | as `archives.singlefile` | written on finalize |
| `archives.singlefile.started_at` | `articles/{id}` | as `archives.singlefile` | an ISO string, written on upload start |
| `archives.singlefile.created_at` | `articles/{id}` | as `archives.singlefile` | an ISO string, written on finalize |
| `archives.monolith` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.monolith.status` | `articles/{id}` | as `archives.monolith` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.monolith.gcs_path` | `articles/{id}` | as `archives.monolith` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.monolith.gcs_bucket` | `articles/{id}` | as `archives.monolith` |  |
| `archives.monolith.compressed_size` | `articles/{id}` | as `archives.monolith` | written on finalize |
| `archives.monolith.compression_ratio` | `articles/{id}` | as `archives.monolith` | written on finalize |
| `archives.monolith.started_at` | `articles/{id}` | as `archives.monolith` | an ISO string, written on upload start |
| `archives.monolith.created_at` | `articles/{id}` | as `archives.monolith` | an ISO string, written on finalize |
| `archives.readability` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.readability.status` | `articles/{id}` | as `archives.readability` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.readability.gcs_path` | `articles/{id}` | as `archives.readability` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.readability.gcs_bucket` | `articles/{id}` | as `archives.readability` |  |
| `archives.readability.compressed_size` | `articles/{id}` | as `archives.readability` | written on finalize |
| `archives.readability.compression_ratio` | `articles/{id}` | as `archives.readability` | written on finalize |
| `archives.readability.started_at` | `articles/{id}` | as `archives.readability` | an ISO string, written on upload start |
| `archives.readability.created_at` | `articles/{id}` | as `archives.readability` | an ISO string, written on finalize |
| `archives.markdown` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.markdown.status` | `articles/{id}` | as `archives.markdown` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.markdown.gcs_path` | `articles/{id}` | as `archives.markdown` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.markdown.gcs_bucket` | `articles/{id}` | as `archives.markdown` |  |
| `archives.markdown.compressed_size` | `articles/{id}` | as `archives.markdown` | written on finalize |
| `archives.markdown.compression_ratio` | `articles/{id}` | as `archives.markdown` | written on finalize |
| `archives.markdown.started_at` | `articles/{id}` | as `archives.markdown` | an ISO string, written on upload start |
| `archives.markdown.created_at` | `articles/{id}` | as `archives.markdown` | an ISO string, written on finalize |
| `archives.pdf` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.pdf.status` | `articles/{id}` | as `archives.pdf` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.pdf.gcs_path` | `articles/{id}` | as `archives.pdf` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.pdf.gcs_bucket` | `articles/{id}` | as `archives.pdf` |  |
| `archives.pdf.compressed_size` | `articles/{id}` | as `archives.pdf` | written on finalize |
| `archives.pdf.compression_ratio` | `articles/{id}` | as `archives.pdf` | written on finalize |
| `archives.pdf.started_at` | `articles/{id}` | as `archives.pdf` | an ISO string, written on upload start |
| `archives.pdf.created_at` | `articles/{id}` | as `archives.pdf` | an ISO string, written on finalize |
| `archives.screenshot` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.screenshot.status` | `articles/{id}` | as `archives.screenshot` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.screenshot.gcs_path` | `articles/{id}` | as `archives.screenshot` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.screenshot.gcs_bucket` | `articles/{id}` | as `archives.screenshot` |  |
| `archives.screenshot.compressed_size` | `articles/{id}` | as `archives.screenshot` | written on finalize |
| `archives.screenshot.compression_ratio` | `articles/{id}` | as `archives.screenshot` | written on finalize |
| `archives.screenshot.started_at` | `articles/{id}` | as `archives.screenshot` | an ISO string, written on upload start |
| `archives.screenshot.created_at` | `articles/{id}` | as `archives.screenshot` | an ISO string, written on finalize |
| `archives.rendered` | `articles/{id}` | journalSharedArticleUploads, finalizeSharedArticleArchives | the archive gateway entry of that artifact kind |
| `archives.rendered.status` | `articles/{id}` | as `archives.rendered` | `uploading` or `success`; an entry kept whole when it is already a `success` with a `gcs_path` |
| `archives.rendered.gcs_path` | `articles/{id}` | as `archives.rendered` | `gs://<bucket>/archives/<id>/<folder>/<file>` |
| `archives.rendered.gcs_bucket` | `articles/{id}` | as `archives.rendered` |  |
| `archives.rendered.compressed_size` | `articles/{id}` | as `archives.rendered` | written on finalize |
| `archives.rendered.compression_ratio` | `articles/{id}` | as `archives.rendered` | written on finalize |
| `archives.rendered.started_at` | `articles/{id}` | as `archives.rendered` | an ISO string, written on upload start |
| `archives.rendered.created_at` | `articles/{id}` | as `archives.rendered` | an ISO string, written on finalize |
| `pocket` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, upsertSharedArticleForBackfill | built from the user article only by `projectPocket` of `@warg/article-writer` (a create by the re-derive pass stores an empty map) |
| `pocket.favorite` | `articles/{id}` | as `pocket` | |
| `pocket.resolved_id` | `articles/{id}` | as `pocket` | |
| `pocket.status` | `articles/{id}` | as `pocket` | |
| `pocket.time_added` | `articles/{id}` | as `pocket` | |
| `pocket.time_read` | `articles/{id}` | as `pocket` | |
| `stats` | `articles/{id}` | createSharedArticleInTransaction, bootstrapSharedArticle, backfillSharedArticleBaseFields, upsertSharedArticleForBackfill | |
| `stats.last_accessed` | `articles/{id}` | as `stats` | |
| `stats.total_saves` | `articles/{id}` | as `stats`, countSharedArticleSaveInTransaction | |
| `stats.total_views` | `articles/{id}` | as `stats` | |
| `stats.last_saved_at` | `articles/{id}` | countSharedArticleSaveInTransaction | |
| `warg_request_id` | `articles/{id}` | markSharedArticleArchiveStarted, markSharedArticleProcessing, markSharedArticleBackfillBegun | |
| `processing_started_at` | `articles/{id}` | markSharedArticleArchiveStarted, markSharedArticleProcessing, markSharedArticleBackfillBegun | |
| `error` | `articles/{id}` | markSharedArticleFailed, recordSharedArticleBackfillFailure, settleStuckSharedArticle, markSharedArticleBackfillBegun | markSharedArticleBackfillBegun deletes it |
| `failed_at` | `articles/{id}` | markSharedArticleFailed, recordSharedArticleBackfillFailure, settleStuckSharedArticle | |
| `retry_count` | `articles/{id}` | upsertSharedArticleForBackfill, recordSharedArticleBackfillFailure | the archive starts the backfill made |
| `status_updated_at` | `articles/{id}` | setSharedArticleDerivedStatus | |
| `failure` | `articles/{id}` | recordSharedArticleBackfillFailure | the last failed archive start |
| `failure.class` | `articles/{id}` | as `failure` | `ACCESS_OR_AUTH`, `WORKFLOW_TRIGGER`, `TRANSIENT_UPSTREAM`, `DATA_ISSUE` |
| `failure.last_seen_at` | `articles/{id}` | as `failure` | |
| `failure.count` | `articles/{id}` | as `failure` | incremented |
| `failure.last_error_message` | `articles/{id}` | as `failure` | |
| `failure.first_seen_at` | `articles/{id}` | as `failure` | written on the first failure only |
| `mergedInto` | `articles/{id}` | markSharedArticleMergedInBulk | the winner of a merged duplicate |
| `metadata` | `articles/{id}` | finalizeSharedArticleArchives | the reader metadata; the "Firestore field names (snake_case)" table above is the contract of its fields |
| `metadata.title` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.excerpt` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.byline` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.word_count` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.published_time` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.site_name` | `articles/{id}` | as `metadata` | see the table above |
| `metadata.lead_image` | `articles/{id}` | as `metadata` | see the table above |
| `images` | `articles/{id}` | finalizeSharedArticleArchives | an array of `{ src, height?, width? }` |
| `canonicalId` | `users/{uid}/articles/{id}` | linkUserArticleInTransaction, clearUserArticleCanonicalId, moveUserArticleCanonicalIdInBulk, setUserArticleLinkInBulk, clearUserArticleCanonicalIdInBulk | server-owned link, see `MarkerSchema.md` |
| `resolvedId` | `users/{uid}/articles/{id}` | linkUserArticleInTransaction, setUserArticleResolvedLink, setUserArticleLinkInBulk, enqueueUserArticle | |
| `archival_triggered` | `users/{uid}/articles/{id}` | markUserArticleArchivalTriggered, setUserArticleResolvedLink, enqueueUserArticle | |
| `error` | `users/{uid}/articles/{id}` | recordUserArticleError | |
| `error_at` | `users/{uid}/articles/{id}` | recordUserArticleError | |
| `url` | `users/{uid}/articles/{id}` | enqueueUserArticle | the app writes it on its own saves |
| `favorite` | `users/{uid}/articles/{id}` | enqueueUserArticle | |
| `status` | `users/{uid}/articles/{id}` | enqueueUserArticle | |
| `timeAdded` | `users/{uid}/articles/{id}` | enqueueUserArticle | a Firestore Timestamp; the app stores epoch milliseconds and reads a Timestamp as its milliseconds |
| `timeRead` | `users/{uid}/articles/{id}` | enqueueUserArticle | |
| `queued_at` | `users/{uid}/articles/{id}` | enqueueUserArticle | |
| `queued_by` | `users/{uid}/articles/{id}` | enqueueUserArticle | `dashboard` |

## Accepted differences

A metadata field that a file the drift check reads does not carry, on
purpose. Each row exempts that field in that file only, and states why. The
check fails on a row with no reason, a field outside "Firestore field names
(snake_case)", a file it does not read, or a field the file now has (remove
the row then).

| Field | Not found in | Reason |
| ----- | ------------ | ------ |
| `published_time` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | the app does not show it yet; Warg-only |
| `site_name` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | the app does not show it yet; Warg-only |

## User article fields read by the server

The app writes the user article `users/{uid}/articles/{id}` by these names
through
[`android/app/src/main/java/com/jayteealao/trails/services/firestore/UserArticleWire.kt`](../android/app/src/main/java/com/jayteealao/trails/services/firestore/UserArticleWire.kt),
and the cloud functions read them. The drift check fails when one of them is
not a string literal in that file.

| Field | Read by |
| ----- | ------- |
| `url` | `user-triggers/src/handler.ts`, `dashboard-api/src/bootstrap-article.ts`, `dashboard-api/src/list-articles.ts`, `dashboard-api/src/mark-processing.ts`, `backfill-archiver/src/canonical-candidates.ts`, `backfill-archiver/src/index.ts` |
| `title` | `dashboard-api/src/list-articles.ts` |
| `favorite` | `packages/article-writer/src/pocket.ts` (`projectPocket`) |
| `status` | `packages/article-writer/src/pocket.ts` (`projectPocket`), `backfill-archiver/src/index.ts` |
| `timeAdded` | `packages/article-writer/src/pocket.ts` (`projectPocket`), `dashboard-api/src/list-articles.ts` (order) |
| `timeRead` | `packages/article-writer/src/pocket.ts` (`projectPocket`) |
| `timeUpdated` | `backfill-archiver/src/scheduler.ts` |
| `deletedAt` | `backfill-scripts/src/rederive.ts` |

## Producer

The Warg gcs worker produces the metadata map:
`buildFinalizeMetadata()` in
[`warg/workers/gcs/src/metadata.ts`](../warg/workers/gcs/src/metadata.ts)
builds it from the readability result, and `FinalizeRequest.metadata` in
[`warg/workers/gcs/src/types.ts`](../warg/workers/gcs/src/types.ts) types the
finalize request that carries it. The archive gateway receives that request,
typed by `FinalizeRequest.metadata` in
[`warg/cloud-functions/archive-gateway/src/types.ts`](../warg/cloud-functions/archive-gateway/src/types.ts),
and stores it through the article writer: `ArticleMetadata` in
[`warg/packages/article-writer/src/shared-article.ts`](../warg/packages/article-writer/src/shared-article.ts)
is the one type of the metadata on the article document. The drift check reads
all four files and names the one that lacks a field.

## Consumer

Trails reads five of these fields (`title`, `excerpt`, `byline`, `word_count`
and `lead_image`) by their string keys from the metadata map, into
`WargMetadata`, in
[`android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt`](../android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt).
Trails treats all of them as nullable in case the Warg pipeline hasn't
finalized yet. The fields it does not read are listed under "Accepted
differences" above.

## Adding a new field

1. Add a row to the table above.
2. Add it to `buildFinalizeMetadata()` in `warg/workers/gcs/src/metadata.ts`,
   to `FinalizeRequest.metadata` in `warg/workers/gcs/src/types.ts`, and to
   `FinalizeRequest.metadata` in
   `warg/cloud-functions/archive-gateway/src/types.ts`, and to `ArticleMetadata`
   in `warg/packages/article-writer/src/shared-article.ts`.
3. Add it to Trails' `WargMetadata` data class if Trails needs to surface it.
   If Trails does not read it, add a row for it under "Accepted differences"
   with the reason.
4. Update `firebase/firestore.rules` if the field has a validation rule.
5. Run `node --experimental-strip-types shared-types/check-drift.ts`
   locally to confirm.

A new field of the shared article or the user article (outside `metadata`)
gets a row in "Articles document fields" above and its name in the field
lists of `warg/packages/article-writer/src/fields.ts`, in the same commit.

A user-article field the server starts to read gets a row in "User article
fields read by the server" above, in the same commit.
