---
schema: sdlc/v1
type: review
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
status: complete
stage-number: 7
verdict: ship-with-caveats
commands-run:
  - correctness
  - security
  - code-simplification
  - testing
  - maintainability
  - reliability
  - backend-concurrency
  - refactor-safety
  - architecture
  - performance
  - data-integrity
  - privacy
  - docs
metric-commands-run: 13
metric-findings-total: 9
metric-findings-raw: 15
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-med: 0
metric-findings-low: 3
metric-findings-nit: 6
metric-findings-total-ever: 15
created-at: "2026-07-06T02:04:08Z"
updated-at: "2026-07-06T02:04:08Z"
runs:
  - at: "2026-07-06T02:04:08Z"
    dimensions:
      - correctness
      - security
      - code-simplification
      - testing
      - maintainability
      - reliability
      - backend-concurrency
      - refactor-safety
      - architecture
      - performance
      - data-integrity
      - privacy
      - docs
    verdict: ship-with-caveats
    fix-commit: "8362d4c"
tags: [refactor, android, cleanup, simplify]
refs:
  shape: 02-shape.md
  slice-index: 03-slice.md
next-command: wf-handoff
next-invocation: "/wf handoff simplify-android-app"
---

# Review: simplify-android-app (slug-wide)

This branch delivers the full cleanup scope from shape: dead complexity removed, performance-critical N+1 patterns eliminated, the app-lifetime coroutine scope consolidated under Hilt injection, and the FTS search bug fixed. Four HIGH/MED findings surfaced and patched inline. No blockers remain; the branch ships.

## Verdict: Ship with Caveats

**0 OPEN BLOCKERS. 0 OPEN HIGH. 0 OPEN MED.**

4 findings were fixed in commit `8362d4c` before this verdict was written:
- **CR-1 / PE-1 (HIGH):** N+1 serial DAO reads in `syncLocalChanges` chunk tag-prefetch — replaced with bulk `getTagsForArticles()` IN-query.
- **CR-2 (MED):** `performFullSync` called stale `isFirstSync()` (two Firestore reads) after `syncLocalChanges` switched to `getUserMetaSnapshot()` — aligned to single-read path.
- **SE-1 (MED):** Firestore `articleMarkers` fallback `get(articles/{itemId})` proof-surface widens — documented with SECURITY NOTE constraining threat model.
- **RE-1 (MED):** `CancellationException` not re-thrown in `performFullSync` outer catch — added re-throw guard per structured concurrency contract.

## All Findings

| ID | Dim | Sev | Status | File | Issue |
|----|-----|-----|--------|------|-------|
| CR-1 | correctness | HIGH | **fixed** | `FirestoreSyncManager.kt:296-305` | N+1 serial getArticleTags() in syncLocalChanges chunk loop |
| CR-2 | correctness | MED | **fixed** | `FirestoreSyncManager.kt:414` | performFullSync used stale isFirstSync() two-read path |
| SE-1 | security | MED | **fixed** | `firestore.rules:58-66` | Marker fallback proof surface undocumented |
| RE-1 | reliability | MED | **fixed** | `FirestoreSyncManager.kt:476-479` | CancellationException not re-thrown |
| PE-1 | performance | HIGH | **fixed** | `FirestoreSyncManager.kt:296-305` | N+1 DAO reads (cross-ref CR-1) |
| CR-3 | correctness | LOW | deferred | `ArticleListItem.kt:77-82` | tagStates second-pass precedence subtle but correct |
| SE-2 | security | LOW | deferred | `FirestoreBackupService.kt:511` | batchRestoreArticleTags silent empty on unauthenticated |
| TE-1 | testing | LOW | **resolved** | `FirestoreSyncManagerTest.kt` | Bulk DAO tag fetch test gap (CR-1 fix needs companion test) — companion test added (commit `56a6533`) |
| RE-2 | reliability | LOW | deferred | `FirestoreSyncManager.kt:538-542` | reconcile sweep stops on first chunk failure |
| TE-2 | testing | NIT | deferred | `ArticleDao.kt:291-302` | deleteAllTagsForArticle atomicity window untested |
| MA-1 | maintainability | NIT | deferred | `ArticleDao.kt:291-302` | deleteAllTagsForArticle KDoc could be more prescriptive |
| MA-2 | maintainability | NIT | deferred | `FirestoreBackupService.kt:511` | batchRestoreArticleTags silent-empty contract undocumented |
| AR-1 | architecture | NIT | deferred | `FirestoreSyncManager.kt:1-59` | Direct firestore/auth refs alongside BackupService facade |
| PE-2 | performance | NIT | deferred | `ArticleListItem.kt:83-90` | parsedSnippet HtmlCompat.fromHtml initial allocation (memoized) |
| DI-1 | data-integrity | NIT | deferred | `ArticleDao.kt:459` | Pre-existing TODO: timeAdded in upsertNewArticle |

## Dimension Summary

| Dimension | Blockers | HIGH | MED | LOW | NIT | Verdict |
|-----------|----------|------|-----|-----|-----|---------|
| correctness | 0 | 0 (fixed) | 0 (fixed) | 1 defer | 0 | caveats |
| security | 0 | 0 | 0 (fixed) | 1 defer | 0 | caveats |
| code-simplification | 0 | 0 | 0 | 0 | 0 | clean |
| testing | 0 | 0 | 0 | 1 resolved | 1 defer | ship |
| maintainability | 0 | 0 | 0 | 0 | 2 defer | ship |
| reliability | 0 | 0 | 0 (fixed) | 1 defer | 0 | caveats |
| backend-concurrency | 0 | 0 | 0 | 0 | 0 | clean |
| refactor-safety | 0 | 0 | 0 | 0 | 0 | clean |
| architecture | 0 | 0 | 0 | 0 | 1 defer | ship |
| performance | 0 | 0 (fixed) | 0 | 0 | 1 defer | caveats |
| data-integrity | 0 | 0 | 0 | 0 | 1 defer | ship |
| privacy | 0 | 0 | 0 | 0 | 0 | clean |
| docs | 0 | 0 | 0 | 0 | 0 | clean |

## What the Branch Delivers

**Simplification wins:**
- Dead infinite animation, palette computation, and palette state removed from `ArticleListItem.kt` — major recomposition reduction
- `GetArticleWithTextUseCase.kt` deleted; `ArticleListViewModel` delegates to repository directly
- `tagStates` simplified from two `LaunchedEffect` coroutines to a single `remember()` block
- Dead `SyncWorker` methods removed; polling replaced with `syncJob.join()` + timeout

**Correctness fixes:**
- FTS sanitization bug: `searchWithScore` now passes `sanitizedQuery` to DAO
- `getTagsForArticles()` bulk DAO method eliminates N+1 pre-fetch loop (this run)
- `performFullSync` now uses `getUserMetaSnapshot()` single-read path (this run)

**Architecture improvements:**
- `@ApplicationScope` consolidates coroutine lifetime; no consumer can cancel the shared scope
- `withAuthenticatedUser` helper centralizes auth guard across all `FirestoreBackupService` methods
- `addArticleToBatch` is the single write path for article + large-text + tags
- `getUserMetaSnapshot` reduces `isFirstSync + lastSyncTimestamp` from two Firestore reads to one

**Safety net:**
- `reconcileNeverBackedUpArticles()` sweeps articles with `backedUpAt IS NULL` — catches offline-save stranding

## Triage Decisions

| ID | Sev | Decision | Reason |
|----|-----|----------|--------|
| CR-1 | HIGH | Fix | Fixed this run |
| CR-2 | MED | Fix | Fixed this run |
| SE-1 | MED | Fix | Fixed this run |
| RE-1 | MED | Fix | Fixed this run |
| PE-1 | HIGH | Fix | Fixed this run (same as CR-1) |
| CR-3 | LOW | Defer | Semantics correct; subtle only |
| SE-2 | LOW | Defer | Upstream-guarded; add KDoc in follow-up |
| TE-1 | LOW | Open | Needs companion test for getTagsForArticles path |
| RE-2 | LOW | Defer | Safety improvement; next iteration |
| TE-2 | NIT | Defer | Low risk; atomicity window documented |
| MA-1 | NIT | Defer | Doc gap; follow-up |
| MA-2 | NIT | Defer | Doc gap; follow-up |
| AR-1 | NIT | Defer | Minor layering; future cleanup |
| PE-2 | NIT | Defer | Memoized; negligible in practice |
| DI-1 | NIT | Defer | Pre-existing TODO; out of scope |

## Fix Status

| Finding | Fix | Outcome | Commit |
|---------|-----|---------|--------|
| CR-1 | Add `getTagsForArticles(itemIds)` to `ArticleDao`; replace loop in `syncLocalChanges` | fixed | `8362d4c` |
| CR-2 | Replace `isFirstSync()` with `getUserMetaSnapshot()` in `performFullSync` | fixed | `8362d4c` |
| SE-1 | Add SECURITY NOTE comment to `firestore.rules` | fixed | `8362d4c` |
| RE-1 | Add `if (e is CancellationException) throw e` in `performFullSync` catch | fixed | `8362d4c` |
| PE-1 | Same fix as CR-1 | fixed | `8362d4c` |
| TE-1 | Add companion test capturing `tagsByArticleId` — bulk read once per chunk, grouped by itemId | fixed | `56a6533` |

All 148 unit tests pass after fixes (BUILD SUCCESSFUL). No open findings remain; 2 LOW + 6 NIT deferred to follow-up.
