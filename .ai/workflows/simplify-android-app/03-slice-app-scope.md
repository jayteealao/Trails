---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: app-scope
status: defined
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: s
depends-on: [test-net]
tags: [behaviour-change, di, reliability]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-test-net.md, 03-slice-firestore-dedup.md, 03-slice-article-repository.md]
  plan: 04-plan-app-scope.md
  implement: 05-implement-app-scope.md
---

# Slice: Shared @ApplicationScope coroutine scope (quality-1 / A4)

## Goal
Provide a single Hilt `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() + dispatcher)`,
inject it into `ArticleRepository`, and consolidate `FirestoreSyncManager`'s ad-hoc scope onto it,
so long-lived background work is supervised — a child failure must not cancel siblings.

## Why This Slice Exists
Bare `CoroutineScope(dispatcher)` dies on the first child exception — a latent reliability bug.
The PO directed adding a shared supervised app-scope as one of the risky-first items. This slice
is **foundational**: `firestore-dedup` (scope consolidation in SyncManager) and `article-repository`
(scope injection) build on the scope this slice establishes, so it lands before them.

## Scope
- **In:** New `di/` provider for `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() +
  dispatcher)`; inject into `ArticleRepository`; replace `FirestoreSyncManager`'s ad-hoc
  `CoroutineScope(...)` with the injected one. Supervised-isolation test.
- **Out:** ArticleRepository's other cleanups (inject Firebase, bulk add → `article-repository`);
  the FirestoreSyncManager dedup itself (→ `firestore-dedup`). This slice only touches the scope.

## Acceptance Criteria
- **A4** — Given the app DI graph When a long-lived background scope is needed Then a single Hilt
  `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() + dispatcher)` is provided and
  injected into `ArticleRepository`, with `FirestoreSyncManager`'s ad-hoc scope consolidated onto
  it. A child coroutine throwing must not tear down the scope or cancel siblings (verified by a
  supervised-isolation test). `automated`

## Dependencies on Other Slices
- `test-net`: harness for the supervised-scope test.
- Dependents: `firestore-dedup` and `article-repository` consume the scope — land this first.

## Risks
- Edge cases (shape): a child coroutine throwing must not tear down the scope — verify supervised
  isolation; avoid a premature `.cancel()` on the singleton scope (it lives for app lifetime).
- Constructor/DI churn: this changes `ArticleRepository` and `FirestoreSyncManager` constructors;
  sequence before `article-repository` (B3) and `firestore-dedup` (B1) to avoid double-editing the
  same constructors (hard cutover).
