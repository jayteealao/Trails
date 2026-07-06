---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: list-viewmodel
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: s
depends-on: [article-repository]
tags: [behaviour-preserving, viewmodel, repository-boundary]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-article-repository.md, 03-slice-detail-viewmodel.md]
  plan: 04-plan-list-viewmodel.md
  implement: 05-implement-list-viewmodel.md
---

# Slice: ArticleListViewModel cleanup (B5)

## Goal
Remove dead code from `ArticleListViewModel` and move **all** direct DAO usage behind
`ArticleRepository`, so the ViewModel talks only to the repository abstraction.

## Why This Slice Exists
ViewModel-area cleanup with a **broadened** scope per the PO: not just the named DAO sites —
move *every* direct DAO call behind the repository. That requires a stable repository surface,
so it lands after `article-repository` (B3).

## Scope
- **In:**
  - **quality-5:** delete dead `_articles`.
  - **quality-12:** delete the commented-out `sync()`.
  - **quality-11 (broadened):** move ALL direct `ArticleDao` usage in the ViewModel behind
    `ArticleRepository` (adding repo methods where needed), preserving dispatcher/threading.
  - **reuse-6:** delete the pass-through `GetArticleWithTextUseCase`; call
    `articleRepository.pockets()` directly.
- **Out:** Repository internal cleanup (→ `article-repository`); list UI rendering (→ `list-rendering`).

## Acceptance Criteria
- **B5** — Given `ArticleListViewModel` When it accesses article data Then it goes through
  `ArticleRepository` (no direct `ArticleDao` calls), the dead `_articles` and commented `sync()`
  are gone, and the pass-through use case is removed (`pockets()` called on the repo) — with no
  change to observable behaviour and preserved threading/transaction semantics. `automated` + review

## Dependencies on Other Slices
- `article-repository`: needs a stable repository surface; any new pass-through methods are added
  consistently with B3's cleanup. **Sequence after B3.**

## Risks
- Moving DAO calls behind the repo must preserve dispatcher and transaction semantics (shape risk).
- `pockets()` must already exist (or be added) on the repository with identical semantics to the
  deleted use case — plan verifies before deleting `GetArticleWithTextUseCase`.
