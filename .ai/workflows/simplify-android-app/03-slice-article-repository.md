---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: article-repository
status: in-progress
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: s
depends-on: [test-net, app-scope]
tags: [behaviour-preserving, repository, di]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-app-scope.md, 03-slice-fts-search-fix.md, 03-slice-list-viewmodel.md]
  plan: 04-plan-article-repository.md
  implement: 05-implement-article-repository.md
---

# Slice: ArticleRepository cleanup (B3)

## Goal
Tidy `ArticleRepository` (interface + impl) without changing behaviour: inject Firebase rather
than calling `getInstance()` in `delete()`, and use a bulk DAO insert in `add()`.

## Why This Slice Exists
These are the behaviour-preserving repository cleanups, deliberately kept **separate from the FTS
fix** (`fts-search-fix` / A1 touches `searchWithScore`) per the PO so the one intentional
behaviour change stays isolated. It lands after `app-scope` (A4), which already injects the shared
scope into this same class — sequencing both constructor edits avoids double-editing the DI graph.

## Scope
- **In (quality-2 + efficiency-10):**
  - Inject `FirebaseFirestore`/`FirebaseAuth` (drop the raw `getInstance()` in `delete()`).
  - Bulk DAO insert in `add()` (`@Insert(List)`, auto-transactional) instead of per-item inserts.
- **Out:** FTS fix (→ `fts-search-fix`); the `@ApplicationScope` injection itself (→ `app-scope`);
  moving ViewModel DAO usage behind the repo (→ `list-viewmodel`, though it may add repo methods).

## Acceptance Criteria
- **B3** — Given `ArticleRepository` When `delete()` runs Then it uses the injected Firebase
  handle (no `getInstance()`); And When `add()` runs Then it performs a single bulk DAO insert —
  with no change to observable behaviour (existing + `test-net` tests green). `automated` + review

## Dependencies on Other Slices
- `app-scope`: shares the `ArticleRepository` constructor; land A4 first to avoid DI churn.
- `test-net`: repository test harness (`DefaultArticleRepositoryTest`).
- Soft: `fts-search-fix` touches the same file (different method) — sequence A1 first.

## Risks
- Constructor/DI signature change is a hard cutover — update the Hilt module and all injection
  sites in this slice.
- Bulk insert must preserve conflict/upsert semantics of the current per-item path (`upsertNewArticle`
  checks by URL) — do not silently change insert-or-replace behaviour.
