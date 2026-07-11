---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: reconcile-stall-guard
status: complete
stage-number: 3
created-at: "2026-07-09T12:26:33Z"
updated-at: "2026-07-09T12:26:33Z"
complexity: m
depends-on: []
source: extension
source-ref: "runtime sync test (probe of PR #29); regression from handoff commit fd2778e"
extension-round: 1
tags: [refactor, android, sync, firestore, reconcile, bugfix]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  source: ""
  plan: 04-plan-reconcile-stall-guard.md
  implement: 05-implement-reconcile-stall-guard.md
---

# Slice: reconcile-stall-guard

## Goal
Make the never-backed-up reconcile sweep (`FirestoreSyncManager.reconcileNeverBackedUpArticles`)
correct and non-wasteful. Three defects, all found by a live bidirectional-sync test, land together
because they share the same subsystem (the offline-save backup safety net) and the same test harness:

1. **Stall guard aborts the sweep after one chunk (primary bug).** The guard added in the handoff
   (`FirestoreSyncManager.kt:531`, commit `fd2778e`) uses `chunk.size == prevChunkSize`. Two
   consecutive *full* pages both return `RECONCILE_CHUNK_SIZE` (20) rows — which is **normal
   progress** (20 *different* rows stamped each round), not a stall. So the sweep stamps only the
   first 20 and stops. Replace it with **row-identity stall detection** (a stall is the *same* rows
   returning — e.g. the head `itemId` unchanged across iterations — because stamping isn't removing
   them), so the sweep drains the entire backlog.

2. **Sweep is skipped entirely when there are no incremental changes.** In a bidirectional sync the
   upload phase short-circuits with `"No local changes to sync"` *before* the reconcile sweep runs,
   so never-backed-up (offline-stranded) articles are never swept unless something else changed that
   cycle. Ensure the sweep runs regardless of whether incremental `timeUpdated` changes exist.

3. **Freshly-downloaded articles land `backed_up_at = NULL` and re-upload.** On restore, remote
   articles are upserted locally without a `backed_up_at` stamp, so the very next reconcile sweep
   re-uploads articles that already exist in Firestore — wasted writes proportional to the pulled
   set. Stamp `backed_up_at` on download-applied rows (they are, by definition, already backed up).

## Why This Slice Exists
A runtime sync test built during the probe of PR #29 (200 local / 250 remote, articles missing at
both ends of the `timeAdded` order) verified bidirectional reconciliation converged correctly
(local and remote both reached the 300-article union with no boundary skips) — but the same run
exposed that the reconcile *backup* sweep left **30 of the never-backed-up articles unbacked** and
logged `"reconcile: no progress detected (chunk size 20 unchanged), stopping sweep"`. Root cause is
the stall guard introduced by the thread-#6 fix during handoff (`fd2778e`): the offset-0 rewrite was
correct, but its stall signal (chunk-size equality) misfires on any backlog larger than one chunk.
The gating (#2) and pulled-article churn (#3) are adjacent findings from the same test that keep the
safety net from doing its job and make it write redundantly. These are corrections to already-shipped
behaviour, so they are net-new scope (a new slice), not an edit of the completed sync-worker /
firestore-io slices.

## Scope
- **In:**
  - Rewrite the reconcile stall guard to detect a true stall by row identity (not chunk size).
  - Ensure the reconcile sweep executes even when the incremental upload finds no changes.
  - Stamp `backed_up_at` on articles applied during a download/restore so they are not re-uploaded.
  - Regression tests: (a) a >1-full-chunk never-backed-up backlog is fully swept; (b) the sweep runs
    when there are no incremental changes; (c) a download-applied article is not re-uploaded on the
    next sync.
- **Out:**
  - The download-side boundary/pagination behaviour (verified correct in the test — no change).
  - Any change to `getArticlesNeverBackedUp` offset-0 query semantics (the offset-0 approach is
    correct; only the loop's stall guard changes).
  - Sync *timing/throughput* work (the 10k estimate was informational; performance tuning is not in
    this slice).
  - Broader sync-trigger redesign (WorkManager cadence, manual-sync UX) — out of scope.

## Acceptance Criteria
- **AC1 (stall guard, `automated`)** — Given N never-backed-up articles with N > `RECONCILE_CHUNK_SIZE`
  When `reconcileNeverBackedUpArticles()` runs Then all N are stamped `backed_up_at` and uploaded
  (0 remain `backed_up_at IS NULL`), and the sweep does not stop early. A test with a multi-full-chunk
  backlog fails against the current guard and passes after the fix.
- **AC2 (true-stall safety, `automated`)** — Given a backlog where stamping cannot make progress
  (the same rows keep returning) When the sweep runs Then it terminates without an infinite loop
  (the guard still protects against a genuine stall).
- **AC3 (gating, `automated`)** — Given never-backed-up articles and no incremental (`timeUpdated`)
  changes When a sync runs Then the reconcile sweep still executes and backs them up.
- **AC4 (no re-upload churn, `automated`)** — Given an article applied to Room from a remote restore
  When the next reconcile sweep runs Then that article is not re-uploaded (its `backed_up_at` is set
  at download time).
- **AC5 (regression net, `automated`)** — The existing `FirestoreSyncManagerReconcileTest` and the
  full unit suite stay green.

## Dependencies on Other Slices
- `firestore-io`, `sync-worker`, `firestore-dedup` (all **complete**): they introduced the reconcile
  sweep and the sync/backup path this slice corrects. Relationship is **lineage/context only** — no
  blocking dependency, since those slices are done. This slice touches `FirestoreSyncManager.kt`
  (and possibly `ArticleDao`/the restore-apply path) which they own; it must preserve their behaviour
  except for the three defects above.

## Risks
- **Weakening the stall guard could reintroduce an infinite loop** if the new row-identity signal is
  wrong — AC2 exists to pin this. The guard must still fire when stamping genuinely fails.
- **Stamping `backed_up_at` on download (#3) interacts with conflict resolution** — must not mask a
  legitimately-modified local article that needs re-upload; scope the stamp to newly-inserted remote
  rows, not to rows where local was newer.
- **The buggy guard is on the open PR #29.** Ideally this fix lands before that PR merges; if #29
  merges first, this slice becomes a follow-up fix on top. Sequencing is a ship decision, not a
  blocker for planning.
- Behaviour is only unit-verifiable in CI; full confirmation needs the same runtime sync test that
  found it (re-run after the fix to confirm 0 rows remain `backed_up_at IS NULL`).
