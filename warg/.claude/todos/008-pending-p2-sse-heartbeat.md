---
status: pending
priority: p2
issue_id: "008"
tags: [review-architecture, performance, med]
dependencies: []
---

# No SSE keepalive/heartbeat

## Problem Statement
During quiet periods (30-60s browser render), no data flows. Intermediate proxies may drop idle connections, causing fallback to polling.

## Findings
- `workers/logger/src/index.ts:208-244` -- only sends data when events exist

## Proposed Solution
Send SSE comment keepalive every ~15 seconds:
```ts
controller.enqueue(encoder.encode(': heartbeat\n\n'));
```

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Connections survive idle periods
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** MED
**Finding ID:** F08
