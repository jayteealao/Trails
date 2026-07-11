---
schema: sdlc/v1
type: verify-index
slug: simplify-android-app
status: complete
stage-number: 6
created-at: "2026-06-18T22:41:59Z"
updated-at: "2026-07-10T22:37:28Z"
slices-verified: 15
slices-total: 15
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
next-command: wf-review
next-invocation: "/wf review simplify-android-app reconcile-stall-guard"
---

# Verify Index

| Slice | Result | Convergence | Interactive | Notes |
|---|---|---|---|---|
| [test-net](06-verify-test-net.md) | **pass** | not-needed | not-applicable | 23/23 target tests + instrumented compile green; 3 pre-existing `ArchiveServiceTest` failures isolated as out-of-scope |
| [fts-search-fix](06-verify-fts-search-fix.md) | **pass** | not-needed | not-applicable | 7/7 FTS edge-case tests pass; 107-test full suite green; 0 issues found |
| [streaming-restore](06-verify-streaming-restore.md) | **partial** | not-needed | deferred | 113/113 tests pass; A2b code-only met; A2 streaming shape proven by 5 unit tests; interactive heap-profile smoke deferred (no display for AVD boot in this environment) |
| [batched-tag-reads](06-verify-batched-tag-reads.md) | **partial** | not-needed | deferred | 120/120 tests pass; A3 automated read-count proven by 6 unit tests + 1 integration test; 0% APK size delta; lazylogcat smoke deferred (no display for AVD boot in this environment) |
| [app-scope](06-verify-app-scope.md) | **pass** | converged | not-applicable | 122/122 tests pass after 1 fix round (5 compile errors in test files that hadn't been updated after constructor changes); A4 isolation criterion met by AppScopeIsolationTest; fix commit fda9cdc |
| [firestore-dedup](06-verify-firestore-dedup.md) | **pass** | not-needed | not-applicable | 122/122 tests pass (no regression); B1 code-only AC met; `addArticleToBatch`, `withAuthenticatedUser`, tag-backup delegation, dead constants removed — all confirmed by static inspection + full suite |
| [firestore-io](06-verify-firestore-io.md) | **pass** | not-needed | not-applicable | 128/128 tests pass; B2 code-only AC met; single meta read, chunk-batch tags, bulk tag delete all confirmed by 6 efficiency-assertion tests; 0 issues found |
| [article-repository](06-verify-article-repository.md) | **pass** | not-needed | not-applicable | 130/130 tests pass; B3 code-only AC met; `getInstance()` absent, `upsertArticles` called once — confirmed by 2 new unit tests + static inspection; 0 issues found |
| [detail-viewmodel](06-verify-detail-viewmodel.md) | **pass** | not-needed | not-applicable | 139/139 tests pass (9 new `ArticleDetailViewModelTest` + 130 prior suite); B4 code-only AC met; nested combine, typed key, @Singleton UrlModifier, ArchiveType enum all confirmed by targeted tests + static inspection; 0 issues found |
| [list-viewmodel](06-verify-list-viewmodel.md) | **pass** | not-needed | not-applicable | 139/139 tests pass (3 `ArticleListViewModelTest` + full prior suite); B5 code-only AC met; no `ArticleDao` in VM constructor, 6 DAO call-sites replaced with repo calls, `GetArticleWithTextUseCase` deleted, dead `_articles` + `sync()` removed — confirmed by structural inspection + 3 unit tests; 0 issues found |
| [list-rendering](06-verify-list-rendering.md) | **partial** | not-needed | deferred | 140/140 tests pass; B6 structural sub-criteria all met (no animation, remember-wrapped snippet, simplified tag state, shared callbacks, empty handler removed); B8 palette+allowHardware fully met by static inspection; appearance-unchanged + scroll-smoke deferred (no running AVD in this environment) |
| [sync-worker](06-verify-sync-worker.md) | **partial** | not-needed | deferred | 143/143 tests pass (3 new SyncWorkerTest); B7 code-only AC all met (join replaces poll, pagination proven by coVerify, dead methods absent by reflection); observable-behaviour-unchanged deferred (no running AVD in this environment) |
| [cross-cutting-url](06-verify-cross-cutting-url.md) | **pass** | not-needed | not-applicable | 147/147 tests pass (21 UrlNormalizerTest — 17 pre-existing + 4 new extension tests); B9 code-only AC met; 4 article-typed call sites replaced; 0 issues found |
| [architecture-docs](06-verify-architecture-docs.md) | **pass** | not-needed | not-applicable | 2/2 code-only ACs met; 3 docs + README present; leak grep 0 matches in doc files; source accuracy confirmed across 9 claims; collectionGroup framed as client-only; 0 issues found |
| [reconcile-stall-guard](06-verify-reconcile-stall-guard.md) | **pass** | not-needed | not-applicable | 153/153 tests (forced re-run); 5/5 code-only ACs met — identity stall guard (AC1 red→green 20/20/5), genuine-stall termination, idle-cycle sweep gating, download-stamp + local-wins companion; 0 cross-slice regressions; live probe-scenario re-run is a harness-declined post-merge residual (not a pre-ship deferral) |

## Recommended Next Stage

`reconcile-stall-guard` verified (extension slice, round 1): 5/5 code-only ACs met by fresh forced re-run of the full suite (153/153) with a named passing test per criterion; fix loop not entered. All 15 slices now verified.

- **Recommended:** `/wf review simplify-android-app reconcile-stall-guard` — `result: pass`, `convergence: not-needed`; the slice corrects sweep/gating/stamping code that the slug-wide review ledger previously examined, so the accumulating dimensions should see it before PR #29 merges.
- After review: `/wf handoff pr#29` — batch refresh so the open PR's description covers this fix (the buggy guard it replaces is on that PR).
- Alternative: `/wf probe simplify-android-app` — slug-wide probe from a display-capable machine to clear the four standing interactive deferrals (`streaming-restore`, `batched-tag-reads`, `list-rendering`, `sync-worker`); this slice added no new entry (its live re-run is a harness-declined, post-merge residual).
