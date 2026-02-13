---
status: pending
priority: p2
issue_id: "007"
tags: [review-architecture, performance, med]
dependencies: []
---

# 3 SQL queries per poll even when nothing changed

## Problem Statement
Every 1-second poll calls `getEventsForStream` which executes 3 SQL queries (requests, events, artifacts) regardless of whether anything changed.

## Findings
- `workers/logger/src/LoggerDO.ts:375-385` -- always runs all 3 queries

## Proposed Solution
Query events first. If `eventRows.length === 0`, return early with empty events and skip artifacts query.

## Acceptance Criteria
- [ ] Fix implemented
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** MED
**Finding ID:** F07
