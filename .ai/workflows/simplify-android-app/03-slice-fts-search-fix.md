---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: fts-search-fix
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-07-05T21:23:39Z"
complexity: s
depends-on: [test-net]
tags: [behaviour-change, bug, fts]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-test-net.md, 03-slice-article-repository.md]
  plan: 04-plan-fts-search-fix.md
  implement: 05-implement-fts-search-fix.md
---

# Slice: FTS search sanitization fix (quality-8)

## Goal
Fix the real logic bug in `ArticleRepository.searchWithScore`: it computes `sanitizedQuery`
but passes the **raw** query to the DAO, so FTS sanitization/wildcards are silently discarded.
Make the DAO receive the sanitized query and pin the intended semantics with tests.

## Why This Slice Exists
This is one of the three behaviour-changing items and the PO directed it to **land first as
its own slice** with its own pinning tests — kept isolated from the behaviour-preserving
ArticleRepository cleanup (`article-repository` / B3) so the single intentional result-set
change is clearly attributable and reviewable.

## Scope
- **In:** Route the sanitized query into the DAO `MATCH` call in `searchWithScore`; ensure the
  intended sanitized + wildcard/prefix semantics actually reach FTS. New FTS tests covering the
  edge cases below.
- **Out:** Any other ArticleRepository change (inject Firebase, bulk add → `article-repository`;
  app-scope injection → `app-scope`). No FTS schema/tokenizer change.

## Acceptance Criteria
- **A1** — Given a search query containing FTS-special characters (quotes, `*`, operators)
  When `searchWithScore(query)` runs Then the DAO receives the **sanitized** query and results
  reflect the intended sanitized + wildcard/prefix semantics. New FTS tests pin this; pre-fix
  result sets are expected to change. `automated`

## Dependencies on Other Slices
- `test-net`: needs the revived `DefaultArticleRepositoryTest`/DB harness so FTS tests can run.

## Risks
- Result sets change by design — reviewers must not treat the diff in returned rows as a
  regression. Pin the *intended* behaviour, not the old behaviour.
- Edge cases to cover (from shape): unbalanced quotes, lone `*`, FTS operators (AND/OR/NEAR),
  empty/whitespace query, non-ASCII. Malformed-`MATCH` must be avoided (no crash, sane result).
- Shares `ArticleRepository.kt` with `app-scope` and `article-repository`; touches a different
  method (`searchWithScore`) but sequence it first to minimise merge churn (hard cutover).
