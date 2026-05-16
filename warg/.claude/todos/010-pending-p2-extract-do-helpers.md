---
status: pending
priority: p2
issue_id: "010"
tags: [review-architecture, maintainability, med]
dependencies: []
---

# Duplicated DO query/mapping logic between getRequestView and getEventsForStream

## Problem Statement
~50 lines of query and mapping logic duplicated between two DO methods. If schema changes, both must be updated in lockstep.

## Findings
- `workers/logger/src/LoggerDO.ts:296-353` -- `getRequestView`
- `workers/logger/src/LoggerDO.ts:359-408` -- `getEventsForStream`

## Proposed Solution
Extract shared private helpers: `queryEvents`, `mapEventRow`, `mapArtifactRow`, `loadRequestRow`.

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Single source of truth for event/artifact mapping
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** MED
**Finding ID:** F10
