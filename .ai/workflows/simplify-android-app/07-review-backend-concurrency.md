---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: backend-concurrency
status: complete
updated-at: "2026-07-10T23:44:14Z"
metric-findings-total: 0
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-pre-existing: 0
metric-findings-resolved: 0
result: clean
fragment: none
tags: []
refs:
  review-master: 07-review.md
---

# Review: backend-concurrency

## Findings

None. Dimension is clean across the full branch diff.

| ID | Sev | Conf | Status | Pre | Surfaced | File:Line | Issue |
|----|-----|------|--------|-----|----------|-----------|-------|
| (none) | — | — | — | — | — | — | No findings |

## Scope & Concurrency Model

**Reviewed:** slug-wide (`git diff main...HEAD -- android firebase`)
**Unreviewed delta since last run (56a6533):** commits 2ff0200, b8da752, fd2778e, 249eb41 (10 files, +372 −78)

**Concurrency model:**
- Runtime: Kotlin coroutines (structured concurrency, single coroutine per sync invocation)
- Database: Room / SQLite (single-writer; `@Transaction` annotation wraps DAO bodies)
- Shared external state: Firestore (upserts — idempotent by document path)
- Locking strategy: Room `@Transaction` for SQLite atomicity; Firestore WriteBatch for atomic remote writes

**Critical operations in delta:**
- `ArticleRepository.add()` — bulk article + associated-data insert (now transactional)
- `FirestoreBackupService.backupArticlesPaginated()` — chunked Firestore WriteBatch commits
- `FirestoreSyncManager.reconcileNeverBackedUpArticles()` — drain loop with stall guard + iteration cap
- `SyncWorker.repopulateJob` — keyset-paginated non-metrics article load

## Analysis

### commit 2ff0200 — `ArticleRepository.add()` transaction wrap

`add()` previously called `articleDao.upsertArticles(articlesToAdd)` then iterated
`articleData` with five separate DAO calls per article. A crash between the article
upsert and the associated-data inserts left articles without tags/images — a partial-write
atomicity violation. The new `@Transaction` DAO method `upsertArticlesWithAssociatedData`
wraps all calls in a single SQLite transaction. Room's `@Transaction` acquires the SQLite
write lock for the body; all sub-DAOs run on the same connection. **Atomicity restored.**

No concurrency regression: the method is called from a single coroutine in
`ArticleRepositoryImpl`; no concurrent callers share the DAO method.

### commit b8da752 — write-count-aware batch chunking

`backupArticlesPaginated` now tracks `batchWriteCount` (a local `var`) instead of
chunking by article count. All variables (`batch`, `batchWriteCount`, `chunkIndex`,
`successCount`) are local to the function scope. The `articles.forEach` loop is
sequential — no parallel dispatch. The write-count estimate `1 + largeTextWrites +
tags.size + markerKeysFor(article).size` calls the same deterministic private function
that `addMarkerWrites` uses internally, so the pre-estimate matches the actual writes
committed. **No shared mutable state; no concurrency concern.**

### commit fd2778e — keyset pagination in `SyncWorker` and `getNonMetricsArticles`

`repopulateJob` changed from `OFFSET`-based to keyset (`AND itemId > :afterId ORDER BY
itemId ASC`). Under concurrent inserts, OFFSET pagination silently skips rows when new
rows with lower-sorted IDs are inserted between pages. Keyset pagination is stable: the
cursor only advances after each page's work is complete (`afterId = page.last().itemId`
after `jobs.joinAll()`). Articles inserted with IDs that sort ahead of the cursor after
it has passed are missed in this sweep — accepted behavior for a background metrics-fill
job (re-swept next sync). **No new data-corruption risk; prior OFFSET drift eliminated.**

`reconcileNeverBackedUpArticles` already used `OFFSET 0` (always re-query from the top
after stamping removes rows from the predicate) and is unaffected.

### commit 249eb41 — reconcile stall guard, iteration cap, backedUpAt stamping

**Stall guard:** `prevChunkIds: Set<String>` is a local variable. On each iteration the
full set of returned `itemId`s is compared. The guard fires only when the *exact same
set* returns twice consecutively — meaning no rows were removed from the
`backed_up_at IS NULL` predicate after the previous backup, i.e., zero progress. This
is more precise than the prior size-equality guard (which misfired on two consecutive
full pages of *different* rows). Partial stamping failures (caught per-article) can
delay but not prevent the guard firing.

**Iteration cap:** `MAX_RECONCILE_ITERATIONS = 1000` (≈ 20 000 articles) is a
local `iterations` counter. It fires only when the stall guard hasn't already stopped
the loop. Correct failsafe — no shared state.

**backedUpAt stamping on remote-won upserts:** `System.currentTimeMillis()` is called
within a single coroutine. The stamped value is passed into `article.copy(backedUpAt =
…)` before the `upsertArticle` call. No concurrent mutation of the article object.
Local-wins paths deliberately leave `backedUpAt` null (they need the push path).

**Sweep gating (totalCount == 0 branch):** `reconcileNeverBackedUpArticles()` is now
called even when the incremental count is zero, ensuring offline-stranded articles are
swept every sync. The function is `suspend` and runs on the caller's coroutine —
single-threaded with respect to other sync operations in `syncLocalChanges`. Correct.

**updateBackedUpAt exception handling:** each per-article stamp is individually
try/caught. A stamp failure for article X means X re-appears in the next chunk query.
If the full identical set re-appears (all articles in a chunk fail to stamp), the stall
guard fires. If a subset re-appears (some stamp), progress continues. This is sound —
idempotent Firestore writes mean re-uploading an already-uploaded article is harmless.

## Summary

- Open findings: 0    (resolved this run: 0)
- Open blockers: 0    (pre-existing excluded; pre-existing findings: 0)
- Status: Clean
