---
status: pending
priority: p2
issue_id: "011"
tags: [review-architecture, api-contracts, med]
dependencies: []
---

# SSE event protocol not formally defined in shared types

## Problem Statement
The four SSE event types (init, log, state, done) and their JSON shapes are defined only implicitly in code. No shared type definitions.

## Findings
- Producer: `workers/logger/src/index.ts:159-235`
- Consumer: `pages/dashboard/modules/views/detail.js:58-86`
- No types in `packages/shared/src/logging.ts`

## Proposed Solution
Define SSE event types in `packages/shared/src/logging.ts` alongside existing `CanonicalRequestView`.

## Acceptance Criteria
- [ ] Types defined in shared package
- [ ] Logger worker imports and uses them
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** MED
**Finding ID:** F11
