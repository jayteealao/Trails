---
status: done
priority: p1
issue_id: "005"
tags: [review-architecture, scalability, high]
dependencies: []
---

# N viewers = N RPC calls/sec to single-threaded DO

## Problem Statement
Each SSE connection independently polls the DO every 1 second. N viewers produce N serial RPC calls/sec competing with pipeline writes.

## Findings
- `workers/logger/src/index.ts:210` -- `setTimeout(resolve, 1000)`
- DO is single-threaded; reads compete with `appendEvent` writes
- 50+ viewers could noticeably degrade write latency

## Proposed Solution
Increase poll interval from 1s to 3s (one-line change). Dashboard latency increases from ~500ms avg to ~1500ms avg, acceptable for admin dashboard.

## Acceptance Criteria
- [ ] Poll interval changed to 3000ms
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** HIGH
**Finding ID:** F05
