---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: reconcile-stall-guard
status: complete
stage-number: 5
created-at: "2026-07-10T22:04:29Z"
updated-at: "2026-07-10T22:04:29Z"
metric-files-changed: 4
metric-lines-added: 193
metric-lines-removed: 16
metric-deviations-from-plan: 2
metric-review-fixes-applied: 0
commit-sha: "249eb41e4c9bf1f7632da68743a0f31be6cbb7bd"
tags: [refactor, android, sync, firestore, reconcile, bugfix]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-reconcile-stall-guard.md
  plan: 04-plan-reconcile-stall-guard.md
  siblings: [05-implement-sync-worker.md, 05-implement-firestore-io.md, 05-implement-firestore-dedup.md]
  verify: 06-verify-reconcile-stall-guard.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app reconcile-stall-guard"
---

# Implement: reconcile-stall-guard

## The Implementation

The offline-save safety net now drains its whole backlog instead of stopping after the first
20 articles. The stall guard in `reconcileNeverBackedUpArticles()` no longer compares chunk
*sizes* — two consecutive full pages of twenty *different* rows are normal progress, which is
exactly the shape that stranded 30 articles in the live probe — it compares the *set of itemIds*:
a stall is the same rows coming back twice, which only happens when stamping isn't removing them
from the predicate. A `MAX_RECONCILE_ITERATIONS = 1000` hard cap backstops the identity signal
with its own distinct `Timber.w` ("work may remain"), so a cap exit and a normal `finished` exit
are distinguishable in logcat. The sweep also logs its backlog count at start, making the
"N remaining → 0" of the eventual live re-run directly observable.

The two adjacent defects landed with it. The sweep now runs inside `syncLocalChanges()`'s
`totalCount == 0` branch, so "no incremental changes" no longer skips the safety net — offline-
stranded articles are invisible to the incremental count by construction, so this was the only
path that would ever catch them on a quiet cycle. And both remote-won upserts in
`handleRemoteArticleChange()` now stamp `backedUpAt` at apply time: a row applied from Firestore
is by definition already backed up, and before this fix every pulled article re-entered the sweep
and was re-uploaded — a billed Firestore write per article per restore. The local-wins branch
deliberately stays unstamped (a newer local row legitimately needs the push path).

One load-bearing deviation: the plan's claim that the existing multi-page test was a built-in
red→green oracle was wrong. Its pages were sized 20 and 5 — different sizes never trip the
size-equality guard — so it passed against the buggy code. The test was strengthened to a
multi-full-chunk backlog (20/20/5, 45 articles), which failed against the old guard exactly as
AC1 requires (recorded red at `FirestoreSyncManagerReconcileTest.kt:120`), then passed after the
fix. The full suite is green at 153/153 (149 pre-existing — the plan's 143 baseline had grown
with later slices — plus 4 new tests covering AC2, AC3, and both directions of AC4).

The plan's stamp-monotonicity audit surfaced one real, pre-existing wart: `upsertNewArticle()`'s
merge-copy (`ArticleDao.kt:502`) rebuilds a re-saved article without carrying
`existingArticle.backedUpAt`, resetting the stamp to NULL. It cannot false-stall the new guard
(a re-entered row changes the fetched id-set) and costs at most one redundant sweep upload of a
genuinely-changed row, so it was flagged as a follow-up task rather than folded into this slice.

## Summary of Changes

- Rewrote the reconcile stall guard from chunk-size equality to full-chunk row-identity
  (`Set<String>` of itemIds), fixing the primary bug that aborted the sweep after one chunk.
- Added `MAX_RECONCILE_ITERATIONS = 1000` hard cap as an independent second failsafe (AC2).
- Added backlog-count start log via new `ArticleDao.countArticlesNeverBackedUp()` (same predicate
  as `getArticlesNeverBackedUp`).
- Called the sweep inside the `totalCount == 0` early-return branch of `syncLocalChanges()` so it
  runs even when there are no incremental changes (AC3). The existing post-upload call site stays.
- Stamped `backedUpAt = System.currentTimeMillis()` on both remote-won `upsertArticle` copies in
  `handleRemoteArticleChange()` (new-article + conflict-remote-wins); local-wins untouched (AC4).
- Tests: strengthened the multi-page reconcile test to a multi-full-chunk backlog (AC1 red→green);
  new AC2 genuine-stall test; new AC3 gating test; new AC4 stamp test + local-wins companion;
  `countArticlesNeverBackedUp` stubbed once in each test class's strict-mock setup.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` —
  stall-guard rewrite + iteration cap + backlog log (sweep, ~lines 536–600); zero-branch sweep
  call (~line 278); two `backedUpAt` stamps (lines 105, 123).
- `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt` —
  new `countArticlesNeverBackedUp(): Int` COUNT query (line 432).
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerReconcileTest.kt` —
  multi-page test strengthened to 20/20/5; new genuine-stall test; count stub in `setUp`.
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt` —
  new AC3 gating test; new AC4 stamp + local-wins tests; count stub in `setUp`.

## Shared Files (also touched by sibling slices)

- `FirestoreSyncManager.kt` — owned by `firestore-io`/`firestore-dedup`/`sync-worker` lineage;
  their behaviour is preserved except the three defects this slice corrects.
- Both test classes were previously touched by `test-net`, `firestore-io`, `batched-tag-reads`,
  `streaming-restore`; all their assertions remain green.

## Notes on Design Choices

- **Full-chunk identity over head-id** (PO decision): robust to a partial stamp of the head row —
  the set comparison only fires when the *entire* page repeats.
- **`prevChunkIds` assigned after comparison, before backup** (plan step 3): on backup failure the
  sweep returns anyway, so the assignment point is immaterial to the failure path but keeps the
  loop body linear.
- **Cap message wording** distinguishes cap-exit ("work may remain") from normal completion
  ("finished, swept N") per the consult note — the two exits must be tellable apart in logcat.
- **Stamp rides the upsert `copy()`** rather than a post-upsert `updateBackedUpAt` call: atomic,
  no second DAO round-trip, no unstamped window (plan's ladder decision, preserved).
- **Zero-branch ordering**: sweep runs after the "No local changes" log and before
  `Success("Up to date")`, keeping the status line truthful about the cycle's real work.

## Verification Seams Built

- **AC1/AC2/AC3/AC4/AC5** → pure-JVM unit tests against directly-constructed
  `FirestoreSyncManager` with mocked ctor deps — the seam (internal visibility of
  `reconcileNeverBackedUpArticles`) already existed from the sync-worker slice.
- **Live-re-run observability (residual deferral)** → backlog-count start log
  `reconcile: starting sweep, N never-backed-up articles` at sweep start
  (`FirestoreSyncManager.kt`, post auth-guard) — makes "N → 0" observable via lazylogcat when the
  one-time manual device confirmation happens. Cap exit and stall exit each have distinct
  `Timber.w` lines for the same purpose.

## Deviations from Plan

1. **AC1 oracle was not red.** The plan asserted the existing multi-page test
   (`reconcile processes multiple pages until empty`) fails against the current guard. It passed:
   its pages (20/5) have different sizes, so size-equality never fired. Strengthened the test to
   three pages (20/20/5, 45 articles — two consecutive *full* chunks) which failed pre-fix
   (AssertionError at line 120, recorded) and passes post-fix. Slice AC1 explicitly calls for a
   multi-full-chunk backlog, so this is a test-strengthening within scope, not new scope.
2. **Baseline count drift.** Plan stated 143/143 across 16 suites; the branch head was already at
   149 (later slices added tests after the sync-worker verify). Post-slice: 153/153, 0 failures.

## Anything Deferred

- **Live probe-scenario re-run** (200 local / 250 remote → 0 rows `backed_up_at IS NULL`) —
  pre-registered deferral, `harness-declined` on the record (PO 2026-07-10): one-time manual
  confirmation on a real device post-merge; all ACs are pure-JVM automated.
- **`upsertNewArticle` stamp preservation** — audit finding (see below), flagged as a standalone
  follow-up task (session chip `task_f7a78e68`); deliberately not folded into this slice.

## Known Risks / Caveats

- **Cyclic re-entry evades the identity guard** (consult note, accepted): alternating pages that
  re-null each other are caught only by the 1000-iteration cap — acceptable for a defensive sweep;
  the cap's distinct log line keeps it diagnosable.
- **Partial-stamp tail** (consult note, accepted): if backup succeeds but one row's stamp keeps
  failing, the sweep drains everything else and exits when the failing singleton page repeats;
  Firestore already has the row, so only a stale NULL marker is retried next sync. PO declined the
  throwing-stamp test variant.
- **Stamp-monotonicity audit result:** `upsertNewArticle()`'s merge-copy (`ArticleDao.kt:502`)
  resets `backedUpAt` to NULL on re-save of an existing URL — pre-existing, benign for the guard
  (set identity changes on re-entry; cap bounds pathology), costs at most one redundant sweep
  upload of a changed row. Follow-up task spawned. All other writers are monotonic:
  `updateBackedUpAt` (non-null only), metadata-enrichment and ViewModel `copy()` paths preserve
  the loaded stamp, fresh inserts correctly start NULL.
- **targetSdk ≥ 34 (future):** `setForeground` will require `FOREGROUND_SERVICE_DATA_SYNC` +
  `dataSync` service type; out of scope at targetSdk 33 (verified present at
  `FirestoreSyncWorker.kt:38`, before `syncLocalChanges()` — the PO's long-drain protection,
  already built).

## Freshness Research

Carried from the plan (checked 2026-07-10, same day): row-identity + hard-cap is the consensus
drain-loop termination pattern; count-comparison is a documented anti-pattern (this exact bug);
Firestore writes billed at $0.18/100k make fix #3 a direct cost saving; no relevant CVEs for
firebase-firestore BoM 34.14.1 / androidx.room. No new external knowledge was needed during
implementation — no additional pass run.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app reconcile-stall-guard` — all five ACs
  are automated and already green here, but verify owns the AC gate and the deferral re-check.
  Consider `/compact` first — implementation context is noise for verification; workflow state
  lives in the artifacts.
- **Option B:** `/wf review simplify-android-app reconcile-stall-guard` — skip verify only if the
  inline 153/153 run is accepted as the AC evidence; not recommended since verify also owns the
  runtime-evidence deferral bookkeeping.
