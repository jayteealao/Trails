---
schema: sdlc/v1
type: handoff
slug: simplify-android-app
slice-slugs: [test-net, fts-search-fix, streaming-restore, batched-tag-reads, app-scope, firestore-dedup, firestore-io, article-repository, detail-viewmodel, list-viewmodel, list-rendering, sync-worker, cross-cutting-url, architecture-docs, reconcile-stall-guard]
handoff-mode: aggregate
handoff-scope: branch
status: complete
stage-number: 8
created-at: "2026-07-06T23:16:56Z"
updated-at: "2026-07-11T00:52:15Z"
revisions:
  - rev: 1
    at: "2026-07-11T00:52:15Z"
    trigger: new-slug-joined
    because: "re-handoff after the reconcile-stall-guard slice landed (fixes the sweep regression this branch introduced in fd2778e) and the rca-saved-articles-no-archives workstream joined the batch; PR-comment triage resolved the last open thread."
    changed: "added reconcile-stall-guard to slice-slugs (14→15); converted to batch handoff (handoff-scope: branch, lead=simplify-android-app); AtomicInteger hardening applied + thread PRRT_kwDOJRfHw86OqwXP resolved (was the prior run's single deferral); readiness re-computed ready; prior body snapshot at history/08-handoff-r1.md."
handoff-fingerprint: "simplify|a3f01d7..a991bd9|slices=15:complete|review=ship|blockers=0"

# Batch fields
handoff-lead: simplify-android-app
branch-slugs: [simplify-android-app, rca-saved-articles-no-archives]
pr-readiness-verdict: ready
pr-title: "refactor(android): codebase cleanup — sync/backup, DI scope, FTS fix, list rendering"
pr-url: "https://github.com/jayteealao/Trails/pull/29"
pr-number: 29
branch: "feat/simplify-android-app"
base-branch: "main"
has-migration: true
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
triage-fixes-applied: 1
triage-fixes-skipped: 0
triage-deferred-thread-ids: []
has-deferred-comments: false
rebase-status: fast-forward
rebase-onto-sha: "a3f01d7aac9e8f047df00066ef77d8443e7e4d30"

# CI-watch + review-settle block (T5.0/T5.3)
ci-watch-conclusion: green
ci-watch-rounds: 22
ci-watch-fix-rounds: 0
bot-reviews-landed: [coderabbitai, gemini-code-assist]
review-settle-elapsed-seconds: 45

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
    - 05-implement-reconcile-stall-guard.md
  reviews: [07-review.md]
next-command: wf-ship
next-invocation: "/wf ship pr#29"
---

# Handoff

## The Handoff

This is the branch's second handoff, and the story has closed a loop. The first pass shipped the
cleanup thesis — 37 triaged findings plus scoped extras across fourteen code-area slices, four
intentional behaviour changes sequenced ahead of behaviour-preserving refactors, held to parity by a
characterization net written first — and declared *ready with one caveat*. That caveat was a deferred
race, and it lived next to a regression the handoff itself had introduced: the concurrent-mutation fix
in `fd2778e` added a stall guard to the never-backed-up reconcile sweep that aborted after a single
full page. A live bidirectional-sync probe of PR #29 stranded 30 offline-saved articles on it. That
probe became the fifteenth slice, **reconcile-stall-guard**, and it is the reason to re-read the diff.

The sweep now detects a genuine stall by *row identity* — the same itemIds returning twice — instead
of chunk-size equality, because two consecutive full pages of twenty *different* rows are normal
progress, exactly the shape that stalled the probe. A `MAX_RECONCILE_ITERATIONS = 1000` cap backstops
the identity signal with its own distinct log line, the sweep now runs on the "no incremental changes"
cycle (the only path that ever catches offline-stranded rows), and remote-won upserts stamp
`backedUpAt` at apply time so a restore no longer re-uploads every pulled article — a billed Firestore
write per article per restore, gone. Strengthening the reconcile test to a multi-full-chunk backlog
(20/20/5) reproduced the bug red-first before the fix took it green; the suite is now **153/153**.

This run also converted the handoff to **batch scope**: the `rca-saved-articles-no-archives`
workstream co-inhabits this branch, and its own commits (the archives deadlock-break, `3c71c9c`
onward) are part of PR #29. Both slugs are review-clean (verdict *ship*, 0 blockers), so the PR now
describes the whole branch as one package rather than leaving the archives commits undisclosed. The
single open thread from last time — gemini's medium-priority note that `selfHealAttempts` is a plain
`var` touched inside the Firestore callback — was resolved this run rather than deferred again: a
one-line `AtomicInteger` hardening (`a991bd9`), delegated to a fix subagent, pushed, thread resolved.
CI re-ran green across build / rules-test / warg-ci; there are **zero** unresolved threads.

Top risk is unchanged and worth repeating: this is a large behaviour-preserving surface proven by
tests, not by running the app. The on-device rungs — restore memory profile, sync logcat showing the
sweep drain "N → 0", list-scroll appearance, and (for the archives workstream) archives appearing on a
freshly-saved article's first open — could not run headless and are the highest-value manual check
around merge.

## PR Title Options
1. refactor(android): codebase cleanup — sync/backup, DI scope, FTS fix, list rendering
2. refactor(android): pay down maintenance + runtime cost across 15 slices + break archives deadlock
3. refactor(android): Firestore sync/backup dedup, streaming restore, reconcile stall-guard, archives fix

## Summary

A codebase-wide cleanup that pays down maintenance and runtime cost without changing user-visible
behaviour — except where a finding was a latent bug worth fixing (FTS search sanitization, unbounded
restore memory + missing large-text rehydration, N+1 tag reads, and the reconcile-sweep stall guard).
37 accepted findings plus scoped extras were resolved across 15 slices spanning the Firestore
sync/backup layer, `ArticleRepository`, the article-list UI, and DI/lifecycle. Behaviour-preserving
refactors are pinned by a characterization suite written first; the intentional changes ship with
their own tests. Reviewed across 13 dimensions (verdict *ship*, 0 open blockers); the PR's bot findings
were triaged to zero open threads (5 fixed/applied over two handoff runs, 1 accepted-as-documented).

## Problem

Duplication, dead code, stringly-typed keys, leaky abstractions, and per-frame Compose work had
accumulated — concentrated in `FirestoreSyncManager`, `FirestoreBackupService`, `ArticleRepository`,
and the article-list components. Four findings were not cosmetic: `searchWithScore` discarded FTS
sanitization; restore fetched per-article tags one at a time (N+1); the "paginated" restore
re-accumulated every page into one in-memory list (OOM risk) without rehydrating large-text articles;
and the offline-save reconcile sweep — added by the first handoff's concurrent-mutation fix — aborted
after one full page, stranding offline-saved articles that never got backed up.

## Solution

- **Correctness (intentional, each pinned by new tests):** FTS passes the sanitized query; streaming
  restore writes each page to Room and does not retain it, with large-text rehydration on the bulk
  path; tag reads batched (client-side chunked) to eliminate the N+1.
- **Reconcile stall guard (slice 15):** stall detection by full-chunk row identity (`Set<String>` of
  itemIds) instead of chunk-size equality; `MAX_RECONCILE_ITERATIONS = 1000` hard cap as an independent
  second failsafe with a distinct log; sweep called inside the `totalCount == 0` early-return branch so
  it runs even with no incremental changes; `backedUpAt` stamped on both remote-won upserts so pulled
  rows aren't re-uploaded each restore; backlog-count start log for live "N → 0" observability.
- **Architecture / lifecycle:** a single `@Singleton @ApplicationScope CoroutineScope(SupervisorJob()
  + dispatcher)` injected into `ArticleRepository`, with `FirestoreSyncManager`'s ad-hoc scope
  consolidated onto it; `withAuthenticatedUser {}` centralizes the auth guard; `addArticleToBatch(...)`
  is the single write path; `getUserMetaSnapshot()` collapses two user-meta reads to one.
- **Simplification / cost:** dead infinite gradient animation + palette state removed from
  `ArticleListItem`; HTML snippet + tag state `remember`-keyed; pass-through `GetArticleWithTextUseCase`
  deleted; `SyncWorker` polling replaced with `syncJob.join()` + timeout and keyset pagination; bulk
  Room ops and per-chunk `WriteBatch` commits chunked by queued-write count.

## Augmentations Applied
None — the `augmentations:` list is empty (no instrument/experiment/benchmark/design augmentations
were scoped for this workflow).

## Affected Areas
- `services/firestore/FirestoreSyncManager.kt`, `FirestoreBackupService.kt` — auth guard, constants,
  single-source write path, streaming restore, batched tag reads, per-chunk batching, consolidated
  scope, reconcile sweep + **row-identity stall guard + iteration cap + zero-branch call + apply-time
  `backedUpAt` stamps**.
- `data/ArticleRepository.kt` (+ `ArticleDao.kt`) — FTS fix, injected Firebase, transactional bulk
  `add()`, injected supervised scope, new `countArticlesNeverBackedUp()` COUNT query.
- `screens/articleDetail/ArticleDetailViewModel.kt`, `screens/articleList/ArticleListViewModel.kt` —
  nested `combine()`, settings key + archive enum, dead-code removal, DAO-behind-repository.
- `screens/articleList/components/{ArticleListItem,AdaptiveArticleGrid,ArticleThumbnail}.kt` —
  recomposition + thumbnail decode cleanup.
- `sync/workers/SyncWorker.kt` — join-not-poll, keyset pagination, dead-method removal.
- New `@ApplicationScope` DI provider; `usecases/GetArticleWithTextUseCase.kt` deleted.
- `firebase/firestore.rules` (+ `firebase/test/firestore-rules.test.ts`) — SECURITY NOTE only for this
  slug (the marker-create rule change belongs to the archives workstream, below).
- Revived test infra + new FTS / streaming / sync characterization / reconcile / Compose tests.

## Verification Evidence
- **Full unit suite green — 153/153, `BUILD SUCCESSFUL`** on the merged post-triage state (baseline
  grew from 143→149→153 as later slices and the reconcile slice added tests).
- Characterization tests written against current Firestore behaviour *before* the dedup refactors.
- Reconcile-stall-guard: multi-full-chunk backlog test recorded red against the old size-equality guard
  (`FirestoreSyncManagerReconcileTest.kt:120`), green after the fix; plus AC2 genuine-stall, AC3 gating,
  AC4 stamp + local-wins companion tests.
- Targeted tests: FTS sanitization; streaming-restore constant-memory + large-text rehydration; batched
  tag-read counts (`verify(exactly=N)`, `coVerify(exactly=0)`); supervised-scope isolation; keyset
  pagination + reconcile-offset contracts; write-count batch chunking.

## Manual Test Notes
Interactive verification was **deferred, not completed** — every slice was verified at the unit-test
rung; the on-device rungs could not run headless (three AVDs installed, no display server / GPU).
Residual manual checks (recorded per-slice in the index's `runtime-evidence-deferrals`):
- Restore a large library and confirm heap stays bounded across pages (memory profiler).
- Bidirectional sync (≥15 articles) and observe chunk-grouped tag reads + page-by-page processing, and
  the reconcile sweep draining "N never-backed-up → 0" via lazylogcat / Timber.
- Scroll the article list (≥20 articles) and confirm appearance unchanged after recomposition cleanup.

## Migration / Config / Rollout Notes
- **This slug needs no schema/index/rules deploy.** Batched tag reads stayed client-only (chunked); the
  `collectionGroup` + composite-index + rules path was evaluated and rejected. The only `firestore.rules`
  change from this slug is a documentation comment (SECURITY NOTE).
- The **branch as a whole** carries one non-destructive Room migration (6→7) and one Firestore rules
  change (marker-create fallback) — both from the archives workstream; see its handoff.
- No dependency upgrades.

## Risks / Caveats
- **Behaviour-preserving by contract, backed by the characterization net + existing tests** — not by
  proof-of-absence. The Firestore sync/backup diffs (now including the reconcile sweep) are the largest
  surface and the highest-value reviewer focus.
- **On-device verification deferred** (see Manual Test Notes).
- **FTS result sets intentionally change** for special-character queries — the fix, not a regression.
- **Zero open PR threads** — the prior run's single deferral (the `selfHealAttempts` race) was fixed
  this run (`a991bd9`).

## Documentation Changes
Delivered by the `architecture-docs` slice (Diátaxis: explanation + reference), no regeneration in
handoff:
- **Explanation** — `docs/architecture/firestore-sync-backup.md`: post-cleanup sync/backup shape,
  single-source helpers, streamed-restore memory contract, FTS fix + result-set impact.
- **Explanation** — `docs/architecture/app-scope-di.md`: the `@ApplicationScope` singleton scope.
- **Reference** — `docs/architecture/batched-tag-reads.md`: the client-only chunked tag-read query.
- **README** — one line on corrected FTS behaviour and the restore memory fix.

## Follow-Up Work
- `upsertNewArticle()`'s merge-copy (`ArticleDao.kt:502`) drops `existingArticle.backedUpAt` on re-save,
  resetting the stamp to NULL — cannot false-stall the new guard, costs at most one redundant sweep
  upload; flagged as a follow-up, not folded into this slice.
- Deferred low-severity / nit findings: tag-state second-pass precedence note; `batchRestoreArticleTags`
  silent-empty KDoc; `deleteAllTagsForArticle` atomicity-window test; direct firestore/auth refs
  alongside the BackupService facade; pre-existing `timeAdded` TODO in `upsertNewArticle`.

## Reviewer Focus Areas
- **Reconcile sweep + stall guard** — the newest and highest-value change; row-identity stall detection,
  the iteration cap, the zero-branch call site, and the apply-time `backedUpAt` stamps.
- **Firestore sync/backup parity** — the largest behaviour-preserving surface.
- **On-device verification CI can't cover** — restore memory-bounded, sync/restore round-trip (incl. the
  sweep draining to zero), and list-scroll appearance unchanged.
- **New pagination correctness** — keyset `getNonMetricsArticles` and the offset-based reconcile sweep.
- **Structured-concurrency guard** — `CancellationException` re-throw + supervised-scope isolation.

## PR Readiness Block
- **Commitlint:** skipped — no commitlint config in the repo.
- **Public-surface drift:** skipped — no `public-surface:` block configured.
- **Doc-mirror:** skipped — no `docs-mirror:` block configured.
- **Rebase onto base:** fast-forward — `origin/main` (`a3f01d7`) is an ancestor of HEAD; no rebase
  needed.
- **CI watch:** green — 22 poll rounds across both watches, 0 fix-rounds on CI itself (the one fix this
  run was a triage fix, not a CI-red fix); Android `build`, `rules-test`, `ci`, `shared-types-drift` all
  SUCCESS, `deploy-rules` SKIPPED.
- **Bot reviews landed:** coderabbitai, gemini-code-assist — settled in 45s.
- **Live review decision:** null — no required human reviewers on this repo.
- **Live checks failing:** none.
- **Live checks pending:** none.
- **Readiness verdict:** ready — CI green, 0 unresolved threads, fast-forward to base, no deferrals.
- **PR-readiness verdict (branch AND):** ready — both roster slugs are package-ready and review-clean.

## Reviewer Comments Triaged

| Source | File:Line | Severity | Summary | Action |
|---|---|---|---|---|
| gemini-code-assist [bot] | ArchiveService.kt:121 | 🟡 | Self-heal counter is a plain `var` touched in the Firestore callback; harden against out-of-order delivery | applied (sha=a991bd9) |

(Prior run's triage — 4 fixes across `2ff0200`/`b8da752`/`fd2778e` and 1 accepted-as-documented rules SECURITY NOTE — is recorded in the r1 snapshot at `history/08-handoff-r1.md`.)

## Freshness Research
- Source: n/a — no external platform/vendor guidance affects this behaviour-preserving cleanup; the one
  rules change (archives workstream) was validated against the Firestore emulator, not release notes.

## Recommended Next Stage
- **Option A (default):** `/wf ship pr#29` — batch-ship both ready slugs on the branch as one atomic
  run; the PR is `ready`, CLEAN, and mergeable.
- **Option B:** `/wf retro simplify-android-app` — if merge auto-deploys and shipping is external.
- **Option C:** manual on-device smoke first (restore memory, sync/reconcile logcat, archives-on-first-
  open), then ship — the deferred rungs are the only unproven surface.
