---
schema: sdlc/v1
type: verify-index
slug: simplify-android-app
status: complete
stage-number: 6
created-at: "2026-06-18T22:41:59Z"
updated-at: "2026-07-06T01:39:23Z"
slices-verified: 14
slices-total: 14
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
next-command: wf-review
next-invocation: "/wf review simplify-android-app architecture-docs"
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

## Recommended Next Stage

`architecture-docs` verified (final slice): both code-only ACs met by filesystem presence check, SDLC leak grep (0 matches in doc files), and source accuracy review against 9 specific claims. No interactive verification needed. Fix loop not entered. All 14 slices now verified.

- **Recommended:** Code review — all 14 slices verified; `result: pass`, `convergence: not-needed`; ready for review. 4 slices carry `interactive-verification: deferred` for live device smoke tests (streaming-restore, batched-tag-reads, list-rendering, sync-worker) — these do not block review or handoff but will require a probe pass before ship.
- Alternative: `/wf probe simplify-android-app` — slug-wide probe from a display-capable machine to clear `streaming-restore`, `batched-tag-reads`, `list-rendering`, and `sync-worker` interactive deferrals in one pass (not required before review).
