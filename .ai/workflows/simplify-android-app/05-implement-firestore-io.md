---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: firestore-io
status: complete
stage-number: 5
created-at: "2026-07-05T23:21:04Z"
updated-at: "2026-07-05T23:21:04Z"
metric-files-changed: 5
metric-lines-added: 148
metric-lines-removed: 34
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "a8434cb"
tags: [behaviour-preserving, firestore, efficiency, room]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-firestore-io.md
  plan: 04-plan-firestore-io.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
  verify: 06-verify-firestore-io.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app firestore-io"
---

# Implement: Firestore read/write efficiency (B2)

## The Implementation

Three independent efficiency wins — one read, one batch boundary, one DAO call — land
on the Firestore sync path with no behaviour change and no new abstractions beyond what
B1 already laid down.

`getUserMetaSnapshot` folds the two back-to-back `users/{uid}` GETs in `syncLocalChanges`
into a single read: a data class returns both `isFirstSync` and `lastSyncTimestamp` from
one Firestore round-trip. `addArticleToBatch` gains an optional `tags` parameter so that
each article's tag docs are written into the same `WriteBatch` that carries the article doc
and markers — eliminating the per-article `backupArticle` delegation block that B1 left as
a `// firestore-io will fix` comment. `ArticleDao.deleteAllTagsForArticle` replaces the
per-tag loop in `handleRemoteArticleChange` with a single SQL `DELETE … WHERE itemId`.

The characterization suite from `test-net` stayed green through every step, and five new
efficiency-assertion tests pass: two for the single meta read, two for tags-in-chunk-batch,
one for the bulk tag delete. The `backupArticlesPaginated` signature grew a `tagsByArticleId`
parameter with a default of `emptyMap()` — the reconcile sweep and other callers are
unaffected.

## Summary of Changes

- **`FirestoreBackupService.kt`**: Added `UserMetaSnapshot` data class and `getUserMetaSnapshot()`
  method (efficiency-1 — single user-meta read). Extended `addArticleToBatch` with
  `tags: List<ArticleTags> = emptyList()` parameter that writes tag docs into the same batch
  (efficiency-2). Extended `backupArticlesPaginated` signature with
  `tagsByArticleId: Map<String, List<ArticleTags>> = emptyMap()` parameter and threaded it
  through to `addArticleToBatch` per article in the chunk loop. Added clarifying comment on
  `MAX_TEXT_SIZE` confirming `toByteArray().size` intent (efficiency-13 non-action).
- **`FirestoreSyncManager.kt`**: Replaced dual `isFirstSync()` + `getLastSyncTimestamp()`
  reads in `syncLocalChanges()` with single `getUserMetaSnapshot()` call (efficiency-1).
  Replaced the per-article `backupArticle` tag-delegation block with a pre-fetch of chunk
  tags and a single `backupArticlesPaginated(..., tagsByArticleId = chunkTagsMap, ...)` call
  (efficiency-2). Replaced the per-tag delete loop in `handleRemoteArticleChange` with
  `articleDao.deleteAllTagsForArticle(remoteArticle.itemId)` (efficiency-3).
- **`ArticleDao.kt`**: Added `deleteAllTagsForArticle(itemId: String)` `@Query` method with
  KDoc noting the brief delete-insert window (efficiency-3).
- **`FirestoreBackupServiceTest.kt`**: Added 4 new tests — `getUserMetaSnapshot` single-read
  happy path and first-sync path; `backupArticlesPaginated` with tags in chunk batch and
  empty `tagsByArticleId` default. Added `coVerify` import.
- **`FirestoreSyncManagerTest.kt`**: Replaced the B1 characterization test
  (`syncLocalChanges backs up tags via backupArticle once per article`) with three B2 tests:
  chunk-batch folding (no `backupArticle` calls), single meta read, and
  `deleteAllTagsForArticle` (exercised via `performFullSync` → `applyRemoteArticles`).

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt` —
  `UserMetaSnapshot` data class + `getUserMetaSnapshot()`; `addArticleToBatch` tags param;
  `backupArticlesPaginated` signature + loop update; `MAX_TEXT_SIZE` comment
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` —
  single meta read; chunk tag pre-fetch; per-article delegation block removed;
  `deleteAllTagsForArticle` in conflict-update path
- `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt` —
  `deleteAllTagsForArticle(itemId)` added
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreBackupServiceTest.kt` —
  B2 efficiency tests added; `coVerify` import added
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt` —
  B1 tag-backup characterization test replaced with three B2 efficiency tests

## Shared Files (also touched by sibling slices)

- `FirestoreBackupService.kt` — also touched by `test-net`, `streaming-restore`,
  `batched-tag-reads`, `firestore-dedup`. B2 changes are additive (new data class, new
  overloaded params with defaults). No conflict.
- `FirestoreSyncManager.kt` — also touched by `app-scope`, `batched-tag-reads`,
  `firestore-dedup`. B2 modifies `syncLocalChanges` (meta read + chunk loop) and
  `handleRemoteArticleChange` (bulk delete). The `applyRemoteArticles` surface is not
  touched — owned by `batched-tag-reads`.

## Notes on Design Choices

- **`UserMetaSnapshot` as a nested data class in `FirestoreBackupService`**: accessible from
  `FirestoreSyncManager` (same package). No need to promote to top-level.
- **`backupArticlesPaginated` signature extension with default `emptyMap()`**: the reconcile
  sweep in `reconcileNeverBackedUpArticles` calls `backupArticlesPaginated(chunk)` with no
  tag map — it compiles unchanged with the default. Other callers (`backupArticles`) also
  unaffected.
- **Tags-in-chunk-batch does not breach the Firestore rules document-access budget**: tag
  subcollection writes (`tags/{tagId}`) have no `getAfter()` check in the security rules.
  Only the `articleMarkers` create/update rule costs one `getAfter()` per article. The
  `WRITE_BATCH_LIMIT = 20` cap is unchanged and sufficient.
- **`performFullSync` single `isFirstSync()` call unchanged**: line 429 is a standalone call
  with no paired `getLastSyncTimestamp()` — already a single read. Only `syncLocalChanges`
  had the two-read pattern.
- **`deleteAllTagsForArticle` window**: delete-then-insert is not `@Transaction`-wrapped.
  The same brief window existed with the prior per-tag loop; background-only path, acceptable.

## Verification Seams Built

- Efficiency-1 (single meta read): `verify(exactly = 1) { userDoc.get() }` in
  `FirestoreBackupServiceTest.getUserMetaSnapshot reads users doc exactly once…`; and
  `coVerify(exactly = 0) { firestoreBackupService.isFirstSync() }` in
  `FirestoreSyncManagerTest.syncLocalChanges makes one meta read not two`.
- Efficiency-2 (tags in chunk batch): `verify(exactly = 1) { batch.set(tagDoc, tag, any()) }`
  and `verify(exactly = 1) { batch.commit() }` in
  `FirestoreBackupServiceTest.backupArticlesPaginated writes tags inside chunk batch…`.
- Efficiency-3 (bulk tag delete): `coVerify(exactly = 1) { articleDao.deleteAllTagsForArticle("r1") }`
  and `coVerify(exactly = 0) { articleDao.deleteArticleTag(any(), any()) }` in
  `FirestoreSyncManagerTest.handleRemoteArticleChange uses deleteAllTagsForArticle…`.

## Deviations from Plan

1. **Plan Step 4 tag pre-fetch format**: The plan showed `articleDao.getArticleTags(article.itemId).map { tag -> ArticleTags(...) }` inside `syncLocalChanges`. The actual implementation puts this in `associate {}` to build `chunkTagsMap` — functionally identical but uses the idiomatic Kotlin `associate` transform instead of `forEach + put`. No observable difference.

## Anything Deferred

- **Efficiency-13 (byte-count comment only)**: `MAX_TEXT_SIZE` already uses `toByteArray().size`
  at both call sites in the codebase. Step 7 adds a clarifying comment at the constant —
  no code change. This was documented as a non-action in the plan.
- **Dead `firestore: FirebaseFirestore` field in `FirestoreSyncManager`**: B2 removed the last
  direct Firestore calls from `FirestoreSyncManager` (the inline batch was removed in B1;
  B2 removes the meta reads). The injected `firestore` field is now unused except as a
  constructor parameter. Removing it requires a Hilt DI graph update and test-constructor
  change not in this slice's scope. Deferred to a future simplify pass (same deferral noted
  in B1's artifact).

## Known Risks / Caveats

- None beyond the brief delete-insert window documented in `ArticleDao.deleteAllTagsForArticle`
  KDoc — same window existed before, background-only path, acceptable.

## Freshness Research

Carried from `04-plan-firestore-io.md`:
- WriteBatch 10 MiB/commit ceiling, `WRITE_BATCH_LIMIT=20` sized for rules getAfter budget.
  Tag writes have no getAfter cost. Confirmed unchanged.
- Room 2.8.0, `@Query` single-statement DELETE is auto-transactional. KSP on Kotlin 2.x
  confirmed. `deleteAllTagsForArticle` is a single SQL statement — no `@Transaction` needed.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app firestore-io` — run characterization
  suite confirming B2 AC (single meta read, chunk-batch tags, bulk tag delete) passes with
  the new test assertions
- **Option B:** `/wf review simplify-android-app firestore-io` — skip verify (suite confirmed
  green locally; behaviour-preserving slice with direct call-count assertions)

---
