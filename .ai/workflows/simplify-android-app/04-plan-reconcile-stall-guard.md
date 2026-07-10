---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: reconcile-stall-guard
status: complete
stage-number: 4
created-at: "2026-07-10T21:32:04Z"
updated-at: "2026-07-10T21:32:04Z"
metric-files-to-touch: 4
metric-step-count: 10
has-blockers: false
revision-count: 0
revisions: []
tags: [refactor, android, sync, firestore, reconcile, bugfix]
stack-source: confirmed
harness-declined: "PO declined a headless-emulator harness (2026-07-10): the wall is environmental (no display/GPU in agent sessions), all 5 ACs are pure-JVM automated, and the live re-run is a one-time manual confirmation on a real device — same posture as the prior 4 deferrals."
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-reconcile-stall-guard.md
  siblings: [04-plan-sync-worker.md, 04-plan-firestore-io.md, 04-plan-firestore-dedup.md]
  implement: 05-implement-reconcile-stall-guard.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app reconcile-stall-guard"
---

# Plan: reconcile-stall-guard

## The Plan

The offline-save safety net has three defects that all live within one file, and the fix for the
worst of them is essentially five lines. The stall guard added in `fd2778e` compares consecutive
chunk *sizes* — so two full pages of 20 different rows look like "no progress" and the sweep
aborts after the first chunk, which is exactly what stranded 30 articles in the live probe run.
The plan replaces that signal with **full-chunk identity** (a stall is the *same set* of itemIds
returning twice, which only happens when stamping isn't removing rows), backed by a generous
`MAX_RECONCILE_ITERATIONS = 1000` hard cap as a second, independent failsafe. The other two fixes
are equally surgical: the sweep gets called inside the `totalCount == 0` zero-branch of
`syncLocalChanges()` so "no incremental changes" no longer skips it, and the two remote-won
`upsertArticle(remoteArticle.copy(...))` sites in `handleRemoteArticleChange()` gain
`backedUpAt = System.currentTimeMillis()` so downloaded articles stop re-uploading (each redundant
re-upload is a billed Firestore write).

Two things make this plan cheaper than it looks. First, **the AC1 test already exists**:
`FirestoreSyncManagerReconcileTest.reconcile processes multiple pages until empty` fakes a
two-page backlog and asserts all 25 articles are stamped — it fails against the current guard and
passes after the fix, giving a built-in red→green confirmation. Second, the PO's request to
protect a long drain with `setForeground()` turned out to be **already implemented** —
`FirestoreSyncWorker.doWork()` calls `setForeground(getForegroundInfo())` at line 38 before
`syncLocalChanges()`, with a complete notification-channel helper, and targetSdk 33 means no
`foregroundServiceType` manifest work is due yet. That lands as a verify-don't-build step,
same as the efficiency-13 precedent.

The top risk is test collateral, not production logic: both sync test classes use **strict**
`@MockK`, so the new `countArticlesNeverBackedUp()` backlog log and the sweep now running in the
zero-branch will make existing tests fail with "no answer found" until their setups stub the new
call. The plan sequences the stubs into the shared `@Before` blocks first for exactly that reason.
The live confirmation (re-run of the 200/250 probe scenario → 0 rows `backed_up_at IS NULL`)
stays a pre-registered deferral: the PO declined a headless-emulator harness on the record — the
recurring device wall is environmental, and every AC here is pure-JVM automated.

## Current State

- `FirestoreSyncManager.kt` (568 lines, `android/app/src/main/java/com/jayteealao/trails/services/firestore/`):
  - `reconcileNeverBackedUpArticles()` (lines 519–559, `internal` for testability): offset-0 drain
    loop — query `getArticlesNeverBackedUp(RECONCILE_CHUNK_SIZE=20, 0)`, back up the chunk via
    `backupArticlesPaginated(chunk)` (no-tags overload, single WriteBatch per page under the
    b8da752 write-count chunking), stamp each row with `updateBackedUpAt(itemId, now)`, repeat.
    The **stall guard at lines 529–534** breaks when `chunk.size == prevChunkSize` — misfires on
    any backlog > 1 full chunk because consecutive full pages are both size 20.
  - `syncLocalChanges()` (lines 228+): computes `totalCount` from `countAllArticles()` /
    `countArticlesModifiedSince(lastSync)`; **`if (totalCount == 0)` returns at line 268**
    ("No local changes to sync", status `Success("Up to date")`) — before the sweep call at
    line 336. Offline-stranded articles are never swept unless something else changed.
  - `handleRemoteArticleChange()` (lines 88–134): two remote-won branches upsert
    `remoteArticle.copy(normalizedUrl = ...)` **without `backedUpAt`** (lines 97 new-article,
    111 conflict-remote-wins); the local-wins branch pushes local via `pushLocalArticle()`.
    Downloaded rows therefore land `backed_up_at = NULL` and the next sweep re-uploads them.
- `ArticleDao.kt` (`android/app/src/main/java/com/jayteealao/trails/data/local/database/`):
  `getArticlesNeverBackedUp(limit, offset)` (`WHERE backed_up_at IS NULL AND deleted_at IS NULL
  ORDER BY timeAdded ASC`) and `updateBackedUpAt(itemId, timestamp)` exist; no count variant.
- Call graph: the sweep has **one call site** (`syncLocalChanges()` line 336). Inbound:
  `FirestoreSyncWorker` (15-min periodic, `ExistingPeriodicWorkPolicy.KEEP`) and
  `FirestoreRestoreWorker` → `performFullSync()` → `syncLocalChanges()`. No feature flags gate
  sync; only `auth.currentUser != null`.
- `FirestoreSyncWorker.doWork()` **already calls `setForeground(getForegroundInfo())`** (line 38)
  before `syncLocalChanges()`, via the shared `Context.syncForegroundInfo()` helper
  (`SyncWorkHelpers.kt` — notification channel, cancel action). `FirestoreRestoreWorker` and
  `SyncWorker` do the same. targetSdk = 33, so the Android 14 `foregroundServiceType` mandate
  does not apply yet.
- Tests: `FirestoreSyncManagerReconcileTest` (5 tests) pins auth-guard, empty-terminator,
  single-page stamp, **multi-page drain (currently failing vs the live guard)**, and on-failure
  stop. `FirestoreSyncManagerTest` covers `syncLocalChanges`/conflict/tag paths and stubs the
  sweep to no-op. Baseline: 143/143 unit tests across 16 suites (sync-worker verify).

## Simplicity Ladder

- **Row-identity stall detection** → rung 4 (new code) — no loop-progress helper exists anywhere
  in the repo (the `SyncWorker` keyset cursor is the nearest concept but isn't extractable for an
  offset-0 predicate-shrink loop). New code is a ~6-line `Set<String>` comparison; PO chose
  full-chunk identity over head-id (robust to partial-stamp of the head row).
- **Iteration hard cap** → rung 4 (new code) — 3 lines (constant + counter + warn/break). PO chose
  a generous constant (1000 ≈ 20k articles) over an exact count-derived cap.
- **Sweep-runs-when-idle (gating)** → rung 3 (reuse) — pure reordering: one added call to the
  existing `reconcileNeverBackedUpArticles()` inside the zero-branch. No new control flow.
- **Download-stamp** → rung 3 (reuse) — the `Article.backedUpAt` field and the `copy()` idiom
  already exist at both apply sites; the stamp rides the existing upsert (atomic, no second write).
  The alternative reuse (`updateBackedUpAt` after upsert) was rejected: extra DAO round-trip and
  an unstamped window.
- **Backlog-count log** → rung 4 (new code) — one new `@Query` COUNT mirroring the existing
  predicate; Room provides the machinery.
- **Long-drain protection (`setForeground`)** → rung 3 (already present) — no work; verify-only.

## Applied Learnings

- No `.ai/solutions/INDEX.md` corpus exists — no applicable learnings found there.
- **Repeat-deferral tripwire (fired):** all four prior slices with runtime residuals
  (`streaming-restore`, `batched-tag-reads`, `list-rendering`, `sync-worker`) name the same wall —
  AVDs installed but no display server/GPU in the headless agent session, `adb devices` empty —
  and this slice's residual (live probe-scenario re-run) names it again. Resolution on the record:
  **`harness-declined`** (see frontmatter) — PO declined a headless-emulator harness
  (2026-07-10, appended to `po-answers.md`); every AC in this slice is pure-JVM automated, and
  the live re-run is a one-time manual confirmation on a real device.

## Likely Files / Areas to Touch

- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt` —
  all three production fixes + backlog log (sweep loop, zero-branch, two upsert copies).
- `android/app/src/main/java/com/jayteealao/trails/data/local/database/ArticleDao.kt` —
  new `countArticlesNeverBackedUp()` query.
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerReconcileTest.kt` —
  AC1 red→green confirmation, new AC2 stall test, count-stub in setup.
- `android/app/src/test/java/com/jayteealao/trails/services/firestore/FirestoreSyncManagerTest.kt` —
  new AC3 gating test, new AC4 download-stamp test (+ local-wins-unstamped companion), count-stubs
  where the zero-branch now reaches the sweep.

## Proposed Change Strategy

Land the test-visible seams in dependency order: DAO count query first (everything stubs it),
then the sweep rewrite, then the gating and stamp fixes, then tests — using the existing failing
multi-page test as the AC1 oracle. All PO decisions (2026-07-10, `po-answers.md`): full-chunk
identity signal; generous 1000-iteration cap; sweep inside the zero-branch (preserves
sweep-after-upload order in the has-changes path and keeps "Up to date" truthful); stamp via the
upsert `copy()` with `System.currentTimeMillis()`; backlog-count start log; `setForeground`
verified-not-built; harness declined for the device wall. Everything is a hard cutover within the
single owning file; no signatures change, no callers move.

## Step-by-Step Plan

1. **Baseline red:** run `./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.services.firestore.FirestoreSyncManagerReconcileTest"`
   (from `android/`) and record that `reconcile processes multiple pages until empty` **fails**
   against the current guard (AC1 pre-fix evidence).
2. **DAO:** add `countArticlesNeverBackedUp(): Int` to `ArticleDao.kt` —
   `SELECT COUNT(*) FROM article WHERE backed_up_at IS NULL AND deleted_at IS NULL` (same
   predicate as `getArticlesNeverBackedUp`; no schema change).
3. **Stall guard rewrite** in `reconcileNeverBackedUpArticles()`: replace `prevChunkSize` with
   `prevChunkIds: Set<String>`; after each fetch compute `chunk.mapTo(mutableSetOf()) { it.itemId }`,
   break with a `Timber.w` ("same N rows returned") when it equals `prevChunkIds`, else assign and
   continue. Delete the size-equality block (lines 529–534) and the `prevChunkSize = chunk.size`
   assignment in `onSuccess`.
4. **Hard cap:** add `MAX_RECONCILE_ITERATIONS = 1000` next to `RECONCILE_CHUNK_SIZE`; increment a
   counter per loop pass; on exceed, `Timber.w` and break (belt-and-braces per AC2).
5. **Backlog log:** at sweep start (post auth-guard), `val backlog = articleDao.countArticlesNeverBackedUp()`;
   `Timber.d("reconcile: starting sweep, $backlog never-backed-up articles")` when > 0 — makes
   "N remaining → 0" directly observable in logcat for the live re-run.
6. **Gating fix** in `syncLocalChanges()`: inside the `totalCount == 0` branch (line 266+), call
   `reconcileNeverBackedUpArticles()` after the "No local changes to sync" log and **before**
   setting `SyncStatus.Success("Up to date")` / the first-sync timestamp update / the return. The
   line-336 call site in the has-changes path stays.
7. **Download-stamp** in `handleRemoteArticleChange()`: add `backedUpAt = System.currentTimeMillis()`
   to the `remoteArticle.copy(...)` at both remote-won sites (line 97 new-article; line 111
   conflict-remote-wins). Local-wins branch untouched.
8. **Reconcile tests** (`FirestoreSyncManagerReconcileTest`): stub
   `coEvery { articleDao.countArticlesNeverBackedUp() } returns <n>` in shared setup (strict
   mocks); confirm the multi-page test now **passes** (AC1 green); add the AC2 test — DAO
   `returns samePage` on every call, backup succeeds, `updateBackedUpAt` no-op → verify the loop
   exits after exactly 2 fetches (`coVerify(exactly = 2) { getArticlesNeverBackedUp(any(), 0) }`,
   `coVerify(exactly = 1) { backupArticlesPaginated(...) }`) and terminates.
9. **Sync-manager tests** (`FirestoreSyncManagerTest`): add count-stubs wherever the zero-branch
   now reaches the sweep (e.g. the "one meta read" test); add the **AC3** test —
   `countArticlesModifiedSince = 0` AND `getArticlesNeverBackedUp` returns a page then empty →
   `coVerify { backupArticlesPaginated(...) }` runs and rows are stamped; add the **AC4** test —
   drive the restore-apply path (existing `handleRemoteArticleChange` test pattern) and assert
   `upsertArticle(match { it.backedUpAt != null })` for a remote-won article, plus a companion
   assertion that a local-wins conflict does **not** stamp (`match { it.backedUpAt == null }` /
   no upsert of the remote copy).
10. **Full suite (AC5) + invariant audit:** `./gradlew :app:testDebugUnitTest` from `android/` —
    143 baseline + new tests, 0 failures. Verify-don't-build: confirm `FirestoreSyncWorker.doWork()`
    still calls `setForeground(getForegroundInfo())` before `syncLocalChanges()` (line 38) — the
    PO's long-drain protection, already present. Consult-driven audit: grep all writers of
    `backed_up_at` / `backedUpAt` and confirm none resets a non-null stamp back to NULL (the
    identity guard's soundness invariant — see Assumptions).

## Verification Strategy

No user-observable AC — automated only. All five ACs are `automated`, pure-JVM
(`junit + mockk + kotlinx-coroutines-test` from the confirmed `stack:`; `FirestoreSyncManager` is
constructed directly with mocked ctor deps, no Android framework):

| AC | Tool / method + ladder rung | Environment need — satisfiable? | What must be BUILT | Fallback chain |
|----|------------------------------|---------------------------------|--------------------|----------------|
| AC1 multi-chunk drain | Existing multi-page unit test, red→green (rung 1: unit) | JVM only — yes | Nothing (test exists; Step 1 records pre-fix failure) | n/a |
| AC2 genuine-stall terminates | New unit test: identical page every fetch → exits after 2 fetches (rung 1) | JVM only — yes | The test (Step 8) | n/a |
| AC3 sweep runs when idle | New unit test: `countArticlesModifiedSince=0` + non-empty backlog → sweep executes (rung 1) | JVM only — yes | The test (Step 9) | n/a |
| AC4 no re-upload churn | New unit test: remote-won upsert carries `backedUpAt != null`; local-wins unstamped (rung 1) | JVM only — yes | The test (Step 9) | n/a |
| AC5 regression net | Full `./gradlew :app:testDebugUnitTest` (rung 1) | JVM only — yes | Nothing | n/a |

- `constraint-resolution:` — none required: no user-observable AC names an environment dependency.
- **Residual (pre-registered deferral, not an AC):** live bidirectional re-run of the probe
  scenario (200 local / 250 remote) on a real device confirming 0 rows remain
  `backed_up_at IS NULL` and logcat shows `reconcile: starting sweep, N…` → drain → `finished`.
  Recurring device wall resolved on the record as **`harness-declined`** (frontmatter;
  PO 2026-07-10). Clearing event: manual device run post-merge.

## Test / Verification Plan

### Automated checks
- Compile: `./gradlew :app:compileDebugKotlin` (from `android/`).
- Focused: `./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.services.firestore.FirestoreSyncManagerReconcileTest"`
  and `--tests "...FirestoreSyncManagerTest"`.
- Full suite: `./gradlew :app:testDebugUnitTest` — baseline 143/143 + new tests, 0 failures.
- No lint/typecheck gate beyond the Kotlin compiler; CI runs `assembleDebug` only.

### Interactive verification (human-in-the-loop)
Automated only — every AC is JVM-unit-testable (see Verification Strategy). The live probe-scenario
re-run is the pre-registered deferral above, executed manually on a real device
(`stack.available-skills: lazylogcat` for log capture when it happens), not a verify-stage step.

## Risks / Watchouts

- **Strict-mock collateral (top risk):** both test classes use strict `@MockK`; the new count call
  and the zero-branch sweep will fail existing tests with "no answer found" until setups stub
  them. Steps 8–9 sequence the stubs first; run the reconcile class in isolation before the suite.
- **Guard weakening / infinite loop:** full-chunk identity fires only on an exactly-repeating
  chunk; the 1000-iteration cap bounds the loop absolutely if the identity signal ever misses
  (AC2 pins termination). Consult note: a *cyclic* re-entry (alternating pages re-nulling each
  other) evades the previous-set comparison and is caught only by the cap — acceptable for a
  defensive sweep, and the cap's `Timber.w` must read as "cap hit, work may remain", distinct
  from the normal `finished` line, so the two exits are distinguishable in logcat.
- **Partial-stamp tail behaviour (consult note, accepted):** if backup succeeds but one row's
  stamp keeps failing, the sweep drains everything else and exits when the failing singleton page
  repeats — Firestore already has the row, so this leaves only a stale NULL marker retried next
  sync. The PO declined the throwing-stamp test variant (round 2); recorded here as known,
  benign behaviour rather than a test gap.
- **Conflict-resolution interaction:** the stamp must ride only the two remote-won copies —
  stamping a local-wins row would exclude a legitimately-newer local article from the sweep.
  AC4's companion assertion pins the local-wins branch unstamped.
- **PR #29 sequencing:** the buggy guard is on the open PR. Same branch, so this lands as a new
  commit on `feat/simplify-android-app`; if #29 merges first, the slice becomes a follow-up fix.
  Ship decision, not a plan blocker.
- **Future targetSdk ≥ 34:** `setForeground` will then require `FOREGROUND_SERVICE_DATA_SYNC`
  permission + a `dataSync` service type on WorkManager's `SystemForegroundService`. Out of scope
  now (targetSdk 33); note for the eventual targetSdk bump.
- **Zero-branch status semantics:** the sweep now runs before `Success("Up to date")` in the idle
  path; a sweep backup failure still just logs-and-returns from the sweep (existing behaviour),
  so the status line stays truthful — do not add new failure surfacing in this slice.

## Dependencies on Other Slices

Lineage only — `firestore-io`, `sync-worker`, `firestore-dedup` (all complete) built the sweep and
backup path this slice corrects; their behaviour is preserved except for the three defects.
No blocking dependency; no sibling plan touches these surfaces anymore.

## Assumptions

- **Stamp is monotonic (consult-flagged, verify at implement):** no code path resets a non-null
  `backed_up_at` back to NULL — rows enter the sweep predicate only at insert. If that invariant
  held false, the identity guard could abort re-entered work (codex high finding). Step 10 audits
  it with a repo-wide grep of `backed_up_at` / `backedUpAt` writers.
- **Remote-wins is deliberately destructive:** `shouldAcceptRemoteChange == true` already
  overwrites divergent local edits today (pre-existing policy, unchanged here) — so stamping the
  remote-won row is correct; the row exactly reflects Firestore. Local edits that must survive go
  through the local-wins branch / incremental `timeUpdated` sync, not the sweep.
- `Article.backedUpAt` round-tripping from Firestore is irrelevant to the fix: any non-null stamp
  excludes the row from the sweep predicate; current-time-at-apply is the chosen value (PO).
- `backupArticlesPaginated(chunk)`'s no-tags overload remains the sweep's upload path (b8da752
  write-count chunking keeps a 20-article page to one batch commit).
- The 143/143 baseline still holds on the branch head (`176d000`); Step 1 re-establishes it.

## Blockers

None.

## Freshness Research

- **Drain-loop termination (consensus):** row-identity detection primary + generous hard cap
  secondary; count-comparison is a documented anti-pattern (misfires on full pages — exactly this
  bug). Offset-0 is *correct* for a predicate-shrinking set; keyset not needed.
  (dev.to/scion01 keyset-vs-offset; designgurus pagination guide.)
- **Firestore pricing:** each re-uploaded doc is a billed write ($0.18/100k) — fix #3 removes
  redundant writes proportional to every pulled set. WriteBatch ≤500 ops remains best practice
  (firebase.google.com/docs/firestore/pricing, /quotas — checked 2026-07-10).
- **Room IN-list limit:** not triggered — `updateBackedUpAt` is single-row and the new query is a
  COUNT; no bulk `IN (...)` added. (sqlite.org/limits: 999 vars pre-API-32.)
- **WorkManager long-running:** ~10-min window without `setForeground()`; already wired here
  (line 38). Android 16 job-quota wrinkle noted for the future; progress is durable per-chunk so
  a killed drain resumes on the next 15-min run. (developer.android.com long-running workers.)
- **CVEs:** none relevant for firebase-firestore Android SDK (BoM v34.14.1) or androidx.room.

## Recommended Next Stage

- **Option A (default):** `/wf implement simplify-android-app reconcile-stall-guard` — the plan is
  execution-ready with a built-in red→green oracle. Consider `/compact` first — planning research
  is noise for implementation; workflow state lives in the artifacts.
- **Option B:** `/wf ship simplify-android-app` sequencing check first — if PR #29 is about to
  merge, decide whether this fix rides the PR or follows it (ship decision flagged in Risks).
