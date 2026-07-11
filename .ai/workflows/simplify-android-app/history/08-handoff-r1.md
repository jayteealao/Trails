---
schema: sdlc/v1
type: handoff
slug: simplify-android-app
slice-slugs: [test-net, fts-search-fix, streaming-restore, batched-tag-reads, app-scope, firestore-dedup, firestore-io, article-repository, detail-viewmodel, list-viewmodel, list-rendering, sync-worker, cross-cutting-url, architecture-docs]
handoff-mode: aggregate
status: complete
stage-number: 8
created-at: "2026-07-06T23:16:56Z"
updated-at: "2026-07-06T23:16:56Z"
pr-title: "refactor(android): codebase cleanup — sync/backup, DI scope, FTS fix, list rendering"
pr-url: "https://github.com/jayteealao/Trails/pull/29"
pr-number: 29
branch: "feat/simplify-android-app"
base-branch: "main"
has-migration: false
has-config-change: true
has-docs-changes: true
docs-generated:
  - docs/architecture/firestore-sync-backup.md
  - docs/architecture/app-scope-di.md
  - docs/architecture/batched-tag-reads.md
  - README.md

# PR-readiness block (T3.5–T5.3)
commitlint-status: skipped
public-surface-drift: skipped
docs-mirror-status: skipped
triage-iterations: 1
triage-fixes-applied: 4
triage-fixes-skipped: 2
triage-deferred-thread-ids: ["PRRT_kwDOJRfHw86OqwXP"]
has-deferred-comments: true
rebase-status: fast-forward
rebase-onto-sha: "a3f01d7aac9e8f047df00066ef77d8443e7e4d30"

# CI-watch + review-settle block (T5.0/T5.3)
ci-watch-conclusion: green
ci-watch-rounds: 16
ci-watch-fix-rounds: 0
bot-reviews-landed: [gemini-code-assist, chatgpt-codex-connector, coderabbitai]
review-settle-elapsed-seconds: 120

live-review-decision: null
live-checks-failing: []
live-checks-pending: []
readiness-verdict: ready

tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  implements:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
    - 05-implement-article-repository.md
    - 05-implement-detail-viewmodel.md
    - 05-implement-list-viewmodel.md
    - 05-implement-list-rendering.md
    - 05-implement-sync-worker.md
    - 05-implement-cross-cutting-url.md
    - 05-implement-architecture-docs.md
  reviews: [07-review.md]
next-command: wf-ship
next-invocation: "/wf ship simplify-android-app"
---

# Handoff

## The Handoff

This branch is the whole cleanup thesis made real: 37 triaged findings plus three scoped extras
resolved across fourteen code-area slices, with the four intentional behaviour changes (the FTS
sanitization fix, streaming restore, batched tag reads, and the consolidated app scope) sequenced
ahead of the behaviour-preserving refactors and held to parity by a characterization net that went
in first. The reason to read the diff carefully is not that anything looks broken — 149 unit tests
are green and CI is clean — but that the value here *is* the invisible: recomposition work removed,
Firestore round-trips collapsed, a shared coroutine scope that no consumer can cancel, and restore
that no longer accumulates the whole library in memory.

What actually changed during handoff is worth flagging. The slug-wide review had already fixed its
four HIGH/MED findings inline, so the branch opened clean — but the PR bots then surfaced six more
threads, and four were real enough to fix on the spot: two genuine correctness bugs in code *this
branch introduced* (offset pagination that could skip rows under concurrent mutation, in both the
SyncWorker sweep and the never-backed-up reconcile loop), plus an atomicity gap in the repository's
bulk `add()` and a batch-chunking hygiene improvement. Those landed in three commits (`2ff0200`,
`b8da752`, `fd2778e`) — dispatched to parallel fix agents, then re-verified together (149/149 green)
before the batch push.

Two findings were deliberately *not* changed, and both belong to the archives self-heal work that
co-inhabits this branch (the `rca-saved-articles-no-archives` workstream), not the cleanup: a
Firestore-rules marker self-heal path that a P1 bot flagged as a privilege-bootstrap — reviewed and
accepted with an in-file `SECURITY NOTE`, per your call — and a theoretical `AtomicInteger` race on
a serially-delivered Firestore callback, deferred to that workstream. The single open review thread
on the PR is that deferred race; everything else is resolved. Readiness is **ready** with that one
documented deferral as the caveat — the same "ship with caveats" posture the review landed on.

Top risk: this is a large behaviour-preserving surface proven by tests, not by running the app. The
on-device rungs (restore memory profile, sync logcat, list-scroll appearance) could not run in a
headless environment and are the highest-value manual check before or right after merge.

## PR Title Options
1. refactor(android): codebase cleanup — sync/backup, DI scope, FTS fix, list rendering
2. refactor(android): pay down maintenance + runtime cost across 14 slices (behaviour-preserving)
3. refactor(android): Firestore sync/backup dedup, streaming restore, batched tags, app-scope DI

## Summary

A codebase-wide cleanup that pays down maintenance and runtime cost without changing user-visible
behaviour — except in three places where a finding was a latent bug worth fixing (FTS search
sanitization, unbounded restore memory + missing large-text rehydration, N+1 tag reads). 37 accepted
findings plus three scoped extras were resolved across the Firestore sync/backup layer, the
`ArticleRepository`, the article-list UI, and DI/lifecycle. Behaviour-preserving refactors are pinned
by a characterization suite written first; the intentional changes ship with their own tests. The
branch was reviewed across 13 dimensions (0 open blockers) and the PR's own bot findings were
triaged: 4 fixed, 1 accepted-as-documented, 1 deferred.

## Problem

Duplication, dead code, stringly-typed keys, leaky abstractions, and per-frame Compose work had
accumulated — concentrated in `FirestoreSyncManager`, `FirestoreBackupService`, `ArticleRepository`,
and the article-list components. Three findings were not cosmetic: `searchWithScore` discarded FTS
sanitization by passing the raw query; restore fetched per-article tags one at a time (N+1); and the
"paginated" restore re-accumulated every page into one in-memory list (OOM risk), without rehydrating
large-text (>900 KB) articles on the bulk path.

## Solution

- **Correctness (intentional, each pinned by new tests):** FTS passes the sanitized query; streaming
  restore writes each page to Room and does not retain it, with large-text rehydration on the bulk
  path; tag reads batched (client-side chunked) to eliminate the N+1.
- **Architecture / lifecycle:** a single `@Singleton @ApplicationScope CoroutineScope(SupervisorJob()
  + dispatcher)` injected into `ArticleRepository`, with `FirestoreSyncManager`'s ad-hoc scope
  consolidated onto it (a child failure can't cancel siblings); `withAuthenticatedUser {}` centralizes
  the auth guard; `addArticleToBatch(...)` is the single write path; `getUserMetaSnapshot()` collapses
  two user-meta reads to one; a `reconcileNeverBackedUpArticles()` sweep catches offline-stranded rows.
- **Simplification / cost:** dead infinite gradient animation + palette state removed from
  `ArticleListItem`; HTML snippet + tag state `remember`-keyed; pass-through `GetArticleWithTextUseCase`
  deleted and DAO usage moved behind the repository; `SyncWorker` polling replaced with
  `syncJob.join()` + timeout and paginated load; bulk Room ops and per-chunk `WriteBatch` commits.

## Augmentations Applied
None — the `augmentations:` list is empty (no instrument/experiment/benchmark/design augmentations
were scoped for this workflow).

## Affected Areas
- `services/firestore/FirestoreSyncManager.kt`, `FirestoreBackupService.kt` — auth guard, constants,
  single-source write path, streaming restore, batched tag reads, per-chunk batching, consolidated
  scope, reconcile sweep.
- `data/ArticleRepository.kt` (+ `ArticleDao.kt`) — FTS fix, injected Firebase, transactional bulk
  `add()` via a new `@Transaction` DAO method, injected supervised scope.
- `screens/articleDetail/ArticleDetailViewModel.kt`, `screens/articleList/ArticleListViewModel.kt` —
  nested `combine()`, settings key + archive enum, dead-code removal, DAO-behind-repository.
- `screens/articleList/components/{ArticleListItem,AdaptiveArticleGrid,ArticleThumbnail}.kt` —
  recomposition + thumbnail decode cleanup.
- `sync/workers/SyncWorker.kt` — join-not-poll, keyset pagination, dead-method removal.
- New `@ApplicationScope` DI provider; `usecases/GetArticleWithTextUseCase.kt` deleted.
- `firebase/firestore.rules` (+ `firebase/test/firestore-rules.test.ts`) — SECURITY NOTE only; no
  schema/index change.
- Revived test infra (`TestDatabaseModule`, `DefaultArticleRepositoryTest`) + new FTS / streaming /
  sync characterization / reconcile / Compose tests.

## Verification Evidence
- **Full unit suite green — 149/149, `BUILD SUCCESSFUL`** on the merged post-triage state.
- Characterization tests written against current Firestore behaviour *before* the dedup refactors,
  pinning parity.
- Targeted tests: FTS sanitization semantics; streaming-restore constant-memory + large-text
  rehydration; batched tag-read counts (`verify(exactly=N)` proves sub-N+1, `coVerify(exactly=0)`
  proves the old path is gone); supervised-scope isolation; keyset-pagination + reconcile-offset
  contracts (added during triage); write-count batch chunking (added during triage).

## Manual Test Notes
Interactive verification was **deferred, not completed** — every slice was verified at the unit-test
rung; the on-device rungs could not run in this headless environment (three AVDs installed, but no
display server / GPU). The residual manual checks (each recorded per-slice in the index's
`runtime-evidence-deferrals`):
- Restore a large library and confirm heap stays bounded across pages (memory profiler).
- Bidirectional sync (≥15 articles) and observe chunk-grouped tag reads + page-by-page processing
  (lazylogcat / Timber).
- Scroll the article list (≥20 articles) and confirm appearance is unchanged after the
  recomposition/thumbnail cleanup (before/after screenshots).

## Migration / Config / Rollout Notes
- **No schema, index, or Firestore-rules deployment required.** Batched tag reads stayed client-only
  (chunked); the `collectionGroup` + composite-index + rules path was evaluated and rejected. The only
  `firestore.rules` change is a documentation comment (SECURITY NOTE).
- No dependency upgrades, no new user-facing features, no UI redesign.

## Risks / Caveats
- **Behaviour-preserving by contract, backed by the characterization net + existing tests — not by
  proof-of-absence.** The Firestore sync/backup diffs are the largest surface and the highest-value
  reviewer focus.
- **On-device verification deferred** (see Manual Test Notes).
- **FTS result sets intentionally change** for special-character queries — the fix, not a regression.
- **One open PR thread by design** — the deferred `AtomicInteger` race (#3), owned by the archives
  self-heal workstream. Non-blocking.

## Documentation Changes
Delivered by the `architecture-docs` slice (Diátaxis: explanation + reference), no regeneration in
handoff:
- **Explanation** — `docs/architecture/firestore-sync-backup.md`: post-cleanup sync/backup shape,
  single-source helpers, streamed-restore memory contract, FTS fix + result-set impact.
- **Explanation** — `docs/architecture/app-scope-di.md`: the `@ApplicationScope` singleton scope, when
  to use it vs `viewModelScope`, why bare `CoroutineScope(dispatcher)` is a reliability bug.
- **Reference** — `docs/architecture/batched-tag-reads.md`: the client-only chunked tag-read query
  shape (why `collectionGroup` was not adopted).
- **README** — one line on corrected FTS behaviour and the restore memory fix.

## Follow-Up Work
Deferred low-severity / nit findings (recorded, non-blocking):
- Tag-state second-pass precedence note; `batchRestoreArticleTags` silent-empty-on-unauthenticated
  KDoc; `deleteAllTagsForArticle` atomicity-window test + KDoc; direct firestore/auth refs alongside
  the BackupService facade; pre-existing `timeAdded` TODO in `upsertNewArticle`.
- The deferred PR threads owned by the `rca-saved-articles-no-archives` workstream: the marker
  self-heal ownership-proof question (accepted-as-documented here) and the `selfHealAttempts`
  `AtomicInteger` race.
- Housekeeping: `firebase/firestore-debug.log` is not gitignored.

## Reviewer Focus Areas
- **Firestore sync/backup parity** — the largest behaviour-preserving surface.
- **On-device verification CI can't cover** — restore memory-bounded, sync/restore round-trip, and
  list-scroll appearance unchanged.
- **New pagination correctness** — keyset `getNonMetricsArticles` and the offset-0 reconcile sweep
  (both added during triage; both test-pinned).
- **Structured-concurrency guard** — `CancellationException` re-throw + supervised-scope isolation.
- **Security surface** — the documented marker-fallback proof surface in `firestore.rules`.

## PR Readiness Block
- **Commitlint:** skipped — no commitlint config in the repo.
- **Public-surface drift:** skipped — no `public-surface:` config.
- **Doc-mirror:** skipped — no `docs-mirror:` config.
- **Rebase onto base:** fast-forward — `origin/main` (`a3f01d7`) is already an ancestor of HEAD; no
  force-push needed.
- **CI watch:** green — 16 poll rounds across the initial watch + post-fix re-watch; 0 CI-red fix
  loops (all fixes were review-triage-driven, not CI-failure-driven). Checks: `build`, `rules-test`,
  `ci` (Warg), `shared-types-drift` all SUCCESS; `deploy-rules` SKIPPED; CodeRabbit SUCCESS.
- **Bot reviews landed:** gemini-code-assist, chatgpt-codex-connector, coderabbitai — settled in ~120s.
- **Live review decision:** null (no required reviewers configured).
- **Live checks failing:** none.
- **Live checks pending:** none.
- **Readiness verdict:** ready — 0 blockers, CI green, `mergeState: CLEAN`, all findings triaged and
  user-decided. Caveat: one intentionally-deferred non-blocking thread (#3) remains open by design,
  tracked in the archives self-heal workstream. Matches the review's "ship-with-caveats" posture.

## Reviewer Comments Triaged

| Source | File:Line | Severity | Summary | Action |
|---|---|---|---|---|
| gemini-code-assist | `ArticleDao.kt:199` | 🔴 High | Offset pagination in new `getNonMetricsArticles` can skip/dupe under concurrent mutation | fixed (sha=`fd2778e`) |
| chatgpt-codex-connector | `FirestoreSyncManager.kt:545` | 🔴 High | Reconcile sweep advances OFFSET over a shrinking predicate → skips rows | fixed (sha=`fd2778e`) |
| gemini-code-assist | `ArticleRepository.kt:198` | 🟡 Suggestion | `add()` multi-step insert not transactional | applied (sha=`2ff0200`) |
| chatgpt-codex-connector | `FirestoreBackupService.kt:735` | 🟡 Suggestion | Chunk backup batches by write count, not article count | applied (sha=`b8da752`) |
| chatgpt-codex-connector | `firestore.rules:75` | 🔴 P1 | Marker self-heal bootstraps read access without ownership proof | declined (accepted-as-documented; RCA-owned) |
| gemini-code-assist | `ArchiveService.kt:121` | 🟡 Suggestion | `selfHealAttempts` var → `AtomicInteger` | deferred (RCA-owned; race is theoretical) |
| coderabbitai | PR-level | 🟢 Info | Walkthrough / summary | noted |

## Freshness Research
- **WriteBatch limit (batch-chunking fix)** — Source: Firestore transactions/quotas docs (carried from
  shape). Why it matters: the reviewer's cited "500-writes hard limit" is outdated. Takeaway: the real
  ceiling is 10 MiB/commit; the fix chunks by write count as throughput hygiene (~500/commit target),
  not to satisfy a hard limit.
- No new external constraint surfaced during handoff; the batched-tag-read approach stayed client-only
  per the resolved efficiency-4 decision, so no shared-project deploy is gated by this PR.

## Recommended Next Stage
- **Option A (default):** `/wf ship simplify-android-app` — the PR is open, CI green, mergeable, and
  all findings are triaged. Ship planning covers the on-device verification residuals + merge.
- **Option B:** `/wf retro simplify-android-app` — if merge/deploy is handled outside this workflow
  (the PR description is the deliverable).
- **Option C:** `/wf implement simplify-android-app <slice>` — only if the manual on-device checks
  surface a regression before ship.
