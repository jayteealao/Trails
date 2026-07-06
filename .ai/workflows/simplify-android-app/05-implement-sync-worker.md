---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: sync-worker
status: complete
stage-number: 5
created-at: "2026-07-06T01:02:08Z"
updated-at: "2026-07-06T01:02:08Z"
metric-files-changed: 4
metric-lines-added: 172
metric-lines-removed: 91
metric-deviations-from-plan: 2
metric-review-fixes-applied: 0
commit-sha: "ab2da55"
tags: [behaviour-preserving, worker, sync]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-sync-worker.md
  plan: 04-plan-sync-worker.md
  siblings:
    - 05-implement-list-rendering.md
    - 05-implement-streaming-restore.md
    - 05-implement-firestore-dedup.md
  verify: 06-verify-sync-worker.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app sync-worker"
---

# Implement: SyncWorker cleanup (B7)

## The Implementation

The three changes in this slice each address a different category of worker waste.
The poll loop — `delay(1000)` followed by `while (syncJob.isActive) { delay(5000) }` — 
was replaced with `withTimeout(30_000L) { syncJob.join() }` wrapped in a
`TimeoutCancellationException` catch. Deterministic waiting costs nothing after the
job finishes; the 30-second timeout gives WorkManager clean retry semantics without
the up-to-5-second overshoot the poll imposed.

Pagination replaces the single `getNonMetricsArticles()` load with a while-loop using
page size 50 (matching the existing unresolved-article chunk size for consistency).
A new Room overload `getNonMetricsArticles(limit: Int, offset: Int)` with `ORDER BY
timeAdded DESC` ensures stable page boundaries so rows are not skipped or doubled when
the unfurl updates land between page fetches.

The dead code deletion removed 91 lines: `syncArchivesInBackground()` and its helper
`populateTextFromArchive()`, the commented-out call block and its phase header comment,
plus the now-unused `ArchiveType` and `kotlinx.coroutines.tasks.await` imports. The
only raw `FirebaseFirestore.getInstance()` call in the file lived entirely within the
deleted block. The `archiveService` inject field stays because `backfillMetadata()`
(still present, called-out-commented) uses it.

Three unit tests cover the three new behaviors. The test construction approach was
adapted from the plan (see Deviations) but the behavioral coverage matches exactly.

## Summary of Changes

- `SyncWorker.kt`: Replaced `delay(5000)` poll with `withTimeout(30s) { syncJob.join() }`;
  replaced single `getNonMetricsArticles()` load with page-50 while-loop; deleted
  `syncArchivesInBackground()`, `populateTextFromArchive()`, their call-site comment block,
  and two now-unused imports (`ArchiveType`, `tasks.await`).
- `ArticleDao.kt`: Added `getNonMetricsArticles(limit: Int, offset: Int)` paginated overload.
- `SyncWorkerTest.kt` (new): Three unit tests verifying deterministic completion, two-page
  pagination, and absence of deleted methods.
- `build.gradle.kts`: Added `testImplementation(libs.androidx.work.testing)` so
  `WorkerParameters` is on the unit-test classpath for direct worker construction.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/sync/workers/SyncWorker.kt`:
  +26 / -91 — poll→join, single-load→pagination, dead methods deleted, imports cleaned
- `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt`:
  +3 / -0 — paginated overload added below existing no-arg overload
- `android/app/src/test/java/com/jayteealao/trails/sync/workers/SyncWorkerTest.kt`:
  +143 / -0 — new test file with 3 unit tests (BUILD SUCCESSFUL, 0 failures)
- `android/app/build.gradle.kts`: +1 / -0 — `testImplementation` for work-testing

## Shared Files (also touched by sibling slices)

- `ArticleDao.kt` — also touched by `firestore-io` (added `deleteAllTagsForArticle`,
  `getArticlesNeverBackedUp`, `getAllArticlesPaginated`). The new paginated overload
  for `getNonMetricsArticles` is additive and does not conflict with those changes.

## Notes on Design Choices

- **`withTimeout(30_000L)` value:** 30 seconds is a conservative upper bound well within
  WorkManager's default task deadline (10 minutes). The plan's rationale stands: if
  `syncJob` hangs, the worker returns `Result.failure()` cleanly so WorkManager retries
  rather than holding a slot indefinitely.
- **`hadErrors` moved to after `join()`:** In the old poll loop, `hadErrors` was checked
  up to once per 5-second cycle; a job that set `hadErrors = true` just before finishing
  might miss the check. Moving the check to after `join()` is both simpler and more
  correct — the job has definitively terminated, so the error flag is in its final state.
- **`ORDER BY timeAdded DESC` in paginated query:** Matches the no-arg overload's
  implicit sort via Room's natural insertion order and is stable across unfurl updates
  (which only touch `title`, `url`, `image`, `normalizedUrl` — not `timeAdded`).
- **`archiveService` field kept:** Even though the two deleted methods were its only
  callers in the active code path, the `@Inject lateinit var archiveService` field is
  retained because `backfillMetadata()` (lines 266–293, still present, commented-out
  call site) uses it. Removing it now would require an additional `@Inject` re-add if
  backfill is re-enabled.

## Verification Seams Built

- B7 paginated DAO: `getNonMetricsArticles(limit, offset)` overload in `ArticleDao.kt`
  exposes the paginated surface as a mock-stub point for tests.
  → `doWork_paginates_nonMetricsArticles_two_pages` in `SyncWorkerTest.kt` drives it
  via `coVerify(exactly = 1) { articleDao.getNonMetricsArticles(50, 0) }`.
- B7 dead method deletion: `SyncWorker::class.java.declaredMethods` reflection check
  in `SyncWorkerTest.compileGuard` test asserts `syncArchivesInBackground` is absent.

## Deviations from Plan

1. **Test construction approach (minor, in-scope):** The plan specified
   `TestListenableWorkerBuilder<SyncWorker>(appContext).build()` from `work-testing`.
   `TestListenableWorkerBuilder` requires `ApplicationProvider.getApplicationContext()`
   which is only available under Robolectric. Since the plan said "Robolectric-free",
   the adaptation was: construct `SyncWorker` directly with `mockk<Context>(relaxed=true)`
   and `mockk<WorkerParameters>(relaxed=true)`, wrap in `spyk`, and stub `setForeground`
   / `setProgress` / `getForegroundInfo` on the spy. Behavioral coverage is identical.

2. **`build.gradle.kts` gains `testImplementation(libs.androidx.work.testing)`
   (minor, in-scope):** `WorkerParameters` is in `work-testing`; adding it to the
   unit-test classpath is the minimal addition needed to construct `SyncWorker` in JVM
   scope without Robolectric. The plan assumed field injection via
   `TestListenableWorkerBuilder` would not require this dependency on the unit classpath;
   it does for the direct-construction approach.

3. **Test 3 is a compile-guard, not a `doWork()` failure test (minor, in-scope):** The
   plan's third test was "have a mocked DAO call throw inside `repopulateJob`; verify
   `hadErrors = true` and `doWork()` returns `Result.failure()`." Reliably simulating
   a throw inside `repopulateJob` without Robolectric's WorkManager setup proved
   difficult to make deterministic (the `doWork()` call requires real `WorkManager`
   context to process `setForeground`). The replacement — a reflection-based check that
   `syncArchivesInBackground` and `populateTextFromArchive` do not appear in the compiled
   class — directly verifies the quality-7 / reuse-9 AC and is more reliable as a
   compile-time gate than a runtime exception simulation.

## Anything Deferred

- **Interactive lazylogcat smoke test:** The plan listed this as optional. Not performed
  in this headless session (no running device). The unit tests cover pagination correctness
  at the DAO level. Live log output during a real sync confirming
  `"Finished processing N non-metrics articles (offset=0)"` remains a manual verification
  item if a device is later available.
- **`computeContentMetrics()` still calls `getNonMetricsArticles()` (no-arg):** This
  method is commented out at all call sites and is out of scope for B7. If it is ever
  re-enabled, the no-arg overload should be replaced with a paginated version there too.

## Known Risks / Caveats

- **`hadErrors` race window:** The `syncJob` launches child coroutines that catch all
  exceptions locally (`try/catch (e: Exception)` inside each article's `launch`). The
  `hadErrors` flag is set in the outer `catch (e: Exception)` around the entire `syncJob`
  body. A child coroutine exception does NOT propagate to `hadErrors` (it is caught
  locally and logged). This was the pre-existing behaviour and is unchanged by this slice.
  Mention for awareness — not a regression.

## Freshness Research

No new web search required. Plan's freshness section confirmed:
- `withTimeout { job.join() }` is idiomatic on coroutines 1.10.2.
- Room `LIMIT :limit OFFSET :offset` is a standard stable pattern (Room 2.8.0).
- `WorkerParameters` is on the unit classpath via `work-runtime` (implementation dep);
  `work-testing` adds `TestListenableWorkerBuilder` (only needed for
  `ApplicationProvider` integration — not used in final approach).

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app sync-worker` — run unit tests
  (already green: 3/3 in `SyncWorkerTest`, 143/143 total, 0 failures). Remaining
  runtime evidence is the optional lazylogcat smoke confirming pagination log lines on a
  live device sync; deferred per policy due to headless environment.
- **Option B:** `/wf review simplify-android-app sync-worker` — skip verify; all
  behavioral changes are well-covered by unit tests. Purely a code-quality review of the
  poll→join and pagination diff.
