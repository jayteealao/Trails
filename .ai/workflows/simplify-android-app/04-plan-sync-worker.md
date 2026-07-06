---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: sync-worker
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 3
metric-step-count: 8
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [behaviour-preserving, worker, sync]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-sync-worker.md
  siblings:
    - 03-slice-firestore-dedup.md
    - 03-slice-streaming-restore.md
  implement: 05-implement-sync-worker.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app sync-worker"
---

# Plan: SyncWorker cleanup (B7)

## Current State

`SyncWorker.doWork()` launches a child `syncJob` on `Dispatchers.IO` and then polls for
its completion using a `delay(1000)` + `while (syncJob.isActive) { delay(5000) }` loop
(lines 171–177). This is fragile: if `hadErrors` becomes `true` mid-poll the worker returns
`Result.failure()` while `syncJob` is still running, and the polling loop wastes CPU for up
to 5 seconds after the job finishes.

**efficiency-9 (lines 171–177):** The poll:

```kotlin
delay(1000)
while (syncJob.isActive) {
    if (hadErrors) {
        return@withContext Result.failure()
    }
    delay(5000)
}
```

The `syncJob` reference is `val syncJob: Job?` assigned at line 80/88 via `launch`. The
correct fix is `syncJob.join()` (suspending, deterministic) wrapped in `withTimeout` to
preserve the cancellation/timeout behaviour the poll implicitly gave.

**efficiency-11 (line 93):** The `repopulateJob` calls
`articleDao.getNonMetricsArticles()` with no pagination, loading all articles whose
`resolved` flag is 1 or 2 in a single `List<Article>`. On large libraries this
materialises the entire set in memory at once before processing begins. The fix is a
paginated overload (`LIMIT :limit OFFSET :offset`) driven by a while-loop inside
`repopulateJob`, page size 50 to match the unresolved-articles chunk in the same job.

**reuse-9 / quality-7:** `syncArchivesInBackground()` (lines 189–243) is a private `suspend
fun` that is commented out at its only call site (line 156, with TODO note). It contains
the only raw `FirebaseFirestore.getInstance()` call in `SyncWorker` (line 203), bypassing
Hilt DI. Its helper `populateTextFromArchive()` (lines 245–257) is only called from inside
`syncArchivesInBackground`. Neither method has any live caller. **Decision: delete both
methods.** The functionality they provided (archive sync to populate article text) is
covered by the already-injected `ArchiveService` (`archiveService: ArchiveService` at
line 71), which exposes `syncArchives()` and `applyScreenshotAsImage()` directly; any
future re-enablement should delegate to `ArchiveService` rather than duplicating Firestore
reads in the worker.

**ARTICLE_LIMIT constant (line 328):** Declared as `private const val ARTICLE_LIMIT = 100`
but only used in the `produceArticles()` channel (itself unused in the active `doWork()`
path). Not touched in this slice.

## Reuse Opportunities

- **`ArchiveService`** is already `@Inject lateinit var archiveService: ArchiveService` at
  line 71 — no new dependency needed; deleting `syncArchivesInBackground` removes the raw
  `getInstance()` call that duplicated what `ArchiveService` already does.
- **Existing unresolved-article chunk size (50)** — already used in `repopulateJob` for
  `postgrestClient.sendArticles(chunk)`. Reuse `50` as the page size for the paginated
  non-metrics load for consistency within the same job.
- **MockK + `StandardTestDispatcher` + `runTest`** — established in
  `ArticleListViewModelTest.kt`; reuse same idiom for new `SyncWorkerTest.kt`.
- **`work-testing` (`TestListenableWorkerBuilder`)** — already declared as
  `androidTestImplementation(libs.androidx.work.testing)` in `build.gradle.kts`; use
  `TestListenableWorkerBuilder` for the worker tests (unit-level with Robolectric-free
  approach: inject mocks directly into worker fields post-construction).

## Likely Files / Areas to Touch

| File | Status | Role | Delta |
|------|--------|------|-------|
| `android/app/src/main/java/com/jayteealao/trails/sync/workers/SyncWorker.kt` | Modified | Primary — efficiency-9, efficiency-11, reuse-9/quality-7 | +8 / −60 |
| `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt` | Modified | New paginated `getNonMetricsArticles(limit, offset)` overload | +4 / −0 |
| `android/app/src/test/java/com/jayteealao/trails/sync/workers/SyncWorkerTest.kt` | New | Worker unit tests asserting deterministic wait + pagination | +90 / −0 |

**No other production files are touched.** `common.kt`, `FirestoreSyncWorker.kt`, and
`FirestoreRestoreWorker.kt` are out of scope.

## Proposed Change Strategy

**syncArchivesInBackground: DELETE (not delegate).**

Rationale: the method is commented out at its only call site with a TODO noting it should
be re-enabled "after verifying `ArticleDetailViewModel.loadArchives()` in isolation." It
has never been live in production. Its logic — iterating `getArticlesNeedingText`, fetching
each Firestore doc with raw `getInstance()`, then calling `archiveService.syncArchives()` —
is exactly the role `ArchiveService` was built to own. If the feature is re-enabled in
future, the correct approach is a dedicated archive-sync worker delegating to
`ArchiveService`, not re-instating raw Firestore reads in `SyncWorker`. Deleting now is
lower-risk than leaving dead code that harbours the only raw `getInstance()` in this file.

`populateTextFromArchive()` is deleted with it (only ever called from the deleted method).

The `// TODO: Re-enable after verifying ...` comment block at line 154–156 is also removed.

## Step-by-Step Plan

**Step 1 — Read `ArticleDao` near getNonMetricsArticles (line 195–196).** Confirm the
existing query SQL and `@Query` annotation. Verify no other callers of the no-arg overload
will be broken by the addition of a paginated overload (grep: only `SyncWorker.kt:93` and
`SyncWorker.kt:291` call it; line 291 is inside the commented-out `computeContentMetrics`
so only line 93 is live).

**Step 2 — Add paginated DAO overload in `ArticleDao.kt`.** Add directly below the
existing `getNonMetricsArticles()`:

```kotlin
@Query("SELECT * FROM article WHERE resolved = 2 OR resolved = 1 ORDER BY timeAdded DESC LIMIT :limit OFFSET :offset")
suspend fun getNonMetricsArticles(limit: Int, offset: Int): List<Article>
```

**Step 3 — Replace the article load in `SyncWorker.doWork()` (efficiency-11).** In
`repopulateJob` (lines 92–151), replace:

```kotlin
val nonMetricsArticles = articleDao.getNonMetricsArticles()
```

with a paginated while-loop:

```kotlin
val pageSize = 50
var offset = 0
while (currentCoroutineContext().isActive) {
    val page = articleDao.getNonMetricsArticles(pageSize, offset)
    if (page.isEmpty()) break
    // existing per-article launch { ... unfurl ... } logic applied to page
    val jobs = page.map { article -> launch(Dispatchers.IO) { /* same unfurl body */ } }
    jobs.joinAll()
    Timber.d("Finished processing ${page.size} non-metrics articles (offset=$offset)")
    offset += pageSize
}
```

The inner `if (nonMetricsArticles.isNotEmpty())` guard becomes the `break` on empty page.
The `Timber.d("Processing ${nonMetricsArticles.size}...")` and
`Timber.d("Finished processing non-metrics articles")` log lines are folded into the loop.

**Step 4 — Replace the delay-poll with `syncJob.join()` (efficiency-9).** Replace lines
171–177:

```kotlin
// OLD
delay(1000)
while (syncJob.isActive) {
    if (hadErrors) {
        return@withContext Result.failure()
    }
    delay(5000)
}
```

with:

```kotlin
try {
    withTimeout(30_000L) { syncJob.join() }
} catch (e: TimeoutCancellationException) {
    Timber.e("SyncWorker: syncJob timed out after 30s — cancelling")
    syncJob.cancel()
    return@withContext Result.failure()
}
if (hadErrors) return@withContext Result.failure()
```

The `hadErrors` check that was inside the poll loop is moved to after `join()` (now only
evaluated once, correctly). The existing `setProgress(workDataOf(PROGRESS to 100))` and
`syncJob.isCancelled` check at lines 179–183 are preserved unchanged.

Add import `kotlinx.coroutines.withTimeout` and `kotlinx.coroutines.TimeoutCancellationException`.
Remove the `delay` import only if it becomes completely unused (check: `delay(1000)` between
chunks at line 142 remains, so the import stays).

**Step 5 — Delete `syncArchivesInBackground` and `populateTextFromArchive`.** Delete:
- Lines 154–157 (the commented-out `// syncArchivesInBackground()` call + phase comment)
- Lines 187–257 (the `syncArchivesInBackground()` and `populateTextFromArchive()` method bodies)

Remove the now-unused imports introduced solely for `syncArchivesInBackground`:
- `com.google.firebase.firestore.FirebaseFirestore` (the raw `getInstance()` import)
- `com.jayteealao.trails.data.archive.ArchiveStatus` (used only inside the deleted method)

Verify `ArchiveType` is still needed by `populateTextFromArchive`'s replacement — since that
method is deleted, check whether `ArchiveType` has any remaining live reference in the file.
If not, remove that import too. (`archiveService` itself stays — it is referenced in
`populateTextFromArchive` which is deleted, but check if any remaining code uses it; the
import of `ArchiveService` stays because `archiveService` is `@Inject`-ed at line 71.)

**Step 6 — Clean up remaining dead code in the same edit window.** Lines 84–86 (commented
`backfillZeroTimestamps`), lines 155–158 (commented phases 7/6) are already commented;
leave as-is — they are not in scope for this slice (their enclosing methods
`backfillMetadata()` and `computeContentMetrics()` are still present but commented out at
call sites; those are out of scope for B7).

**Step 7 — Write `SyncWorkerTest.kt`.** New file at
`android/app/src/test/java/com/jayteealao/trails/sync/workers/SyncWorkerTest.kt`:

Three tests using MockK + `runTest` + `StandardTestDispatcher`:

1. `doWork_join_completes_without_real_delay` — stub `articleDao` paginated query to return
   empty on first call (so repopulateJob finishes immediately); stub `postgrestClient`
   similarly; run `doWork()` with `advanceUntilIdle()`; assert `Result.success()` returned
   and wall-clock time << 5s (no 5s sleep).

2. `doWork_paginates_nonMetricsArticles_two_pages` — stub paginated DAO to return a
   non-empty page on first call, empty on second; verify the inner unfurl logic runs for
   the first page items and the loop terminates after the empty page.

3. `doWork_returns_failure_when_syncJob_throws` — have a mocked DAO call throw inside the
   `repopulateJob`; verify `hadErrors = true` and `doWork()` returns `Result.failure()`.

Use `TestListenableWorkerBuilder<SyncWorker>(appContext).build()` from `work-testing` to
construct the worker, then inject mock dependencies via direct field assignment (Hilt worker
injection is not available in unit scope; field assignment is valid for `@Inject lateinit var`
fields in tests).

**Step 8 — Verify.** Run `./gradlew :app:testDebugUnitTest` — all three new tests must pass
green. Then code-review the diff for behaviour-parity.

## Test / Verification Plan

### Automated

- **Task**: `./gradlew :app:testDebugUnitTest`
  - `SyncWorkerTest` — 3 tests, all green
  - Existing test suite stays green (no regressions from DAO overload addition)

The slice is complete when `./gradlew :app:testDebugUnitTest` passes with zero failures.

### Optional interactive

- **lazylogcat** — if interactive evidence is needed, run the app against a device with
  some articles having `resolved = 1 or 2`, trigger a sync, and capture `SyncWorker` log
  tags via lazylogcat. Confirm `"Finished processing N non-metrics articles (offset=0)"`
  and `"Finished processing 0 non-metrics articles (offset=50)"` (or similar termination)
  appear rather than the old single-batch log. This is optional; the unit tests are the
  primary gate.

## Risks / Watchouts

1. **`join()` must preserve timeout/cancellation (med):** The delay-poll implicitly
   provided up-to-5s responsiveness to `hadErrors`. A bare `join()` would hang if the
   launched coroutine stalls. Mitigated by `withTimeout(30_000L)` — cancel + `Result.failure()`
   on timeout, giving WorkManager clean retry semantics. The 30s is a conservative value
   well within WorkManager's default task deadline.

2. **Paginated load must not change which articles are processed (low):** Must use a stable
   `ORDER BY` clause (`ORDER BY timeAdded DESC`) to avoid row skips or double-processing
   when rows are updated between pages. The existing unfurl update sets `title`, `url`,
   `image`, `normalizedUrl` — not `resolved` — so processed articles won't disappear from
   subsequent pages mid-run, but the ORDER BY is still the correct guard.

3. **Deleting `syncArchivesInBackground` removes dead code, not live behaviour (low):**
   Confirmed via grep: the only call site is line 156 which is commented out. The method
   and its private helper are unreachable. The raw `FirebaseFirestore.getInstance()` at
   line 203 lives entirely within the deleted block. Deletion is safe.

## Dependencies on Other Slices

- **None hard.** `sync-worker` is listed as independent in `03-slice.md` (depends-on: []).
- `streaming-restore` and `firestore-dedup` are OUT of scope for this slice — the worker
  glue only. Changes to `FirestoreSyncWorker.kt` and `FirestoreRestoreWorker.kt` (which
  delegate to `FirestoreSyncManager`) are not part of B7.
- If `article-repository` (B3) renames or refactors `updateArticleText()`, the
  `populateTextFromArchive()` caller is already deleted in this slice — no coupling.

## Assumptions

- `work-testing` (`TestListenableWorkerBuilder`) is available at test scope:
  `androidTestImplementation(libs.androidx.work.testing)` confirmed in `build.gradle.kts`.
  For plain unit tests (not instrumented), inject mock fields directly after
  `TestListenableWorkerBuilder.build()` — this avoids needing a real `Context` with
  WorkManager initialised.
- `kotlinx-coroutines-test` (`StandardTestDispatcher`, `runTest`, `advanceUntilIdle`) is
  available as `testImplementation(libs.kotlinx.coroutines.test)` — confirmed.
- MockK 1.14.5 is available as `testImplementation("io.mockk:mockk:1.14.5")` — confirmed.
- The `delay(1000)` between unresolved-article chunks (line 142) is intentional
  rate-limiting and is NOT removed in this slice.
- The `backfillMetadata()` and `computeContentMetrics()` private methods (lines 260–315)
  are commented out at call sites and are left untouched — they are future phases.

## Blockers

None.

## Freshness Research

From `02-shape.md` freshness section (no new web search required — confirmed applicable to
this slice):

- **`Job.join()` + `withTimeout`**: `withTimeout(ms) { job.join() }` is the idiomatic
  Kotlin coroutines pattern for a bounded join; `TimeoutCancellationException` propagates
  out of the `withTimeout` block and can be caught to return a clean `Result.failure()`.
  This is the correct replacement for a `while (job.isActive) { delay(N) }` poll.
  Source: kotlinx.coroutines docs; no version-specific caveat on coroutines 1.10.2.

- **Room 2.8.0 `@Query` with `LIMIT`/`OFFSET`**: adding a paginated overload with
  `LIMIT :limit OFFSET :offset` is a standard Room pattern; auto-transactional per-query.
  Source: Room docs (carried from shape freshness).

- **WorkManager 2.10.4 `TestListenableWorkerBuilder`**: available for constructing workers
  in tests without a real `WorkManager` instance. Field-inject `@Inject lateinit var`
  properties after `.build()`. Source: WorkManager testing guide.

## Revision History

(none — initial plan)

## Recommended Next Stage

`/wf implement simplify-android-app sync-worker` — execute Steps 1–8 in order.
This slice is independent and can land at any point after the branch is open (no hard
dependency on `test-net` or any other slice, though landing after `test-net` is green is
recommended for safety).
