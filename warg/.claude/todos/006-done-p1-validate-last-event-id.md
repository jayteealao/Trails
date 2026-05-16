---
status: done
priority: p1
issue_id: "006"
tags: [review-architecture, api-contracts, high]
dependencies: []
---

# parseInt of non-numeric Last-Event-ID produces NaN cursor

## Problem Statement
If `Last-Event-ID` contains a non-numeric string, `parseInt` returns `NaN`. SQLite `id > NULL` returns false for all rows, so no events are delivered. Stream idles forever.

## Findings
- `workers/logger/src/index.ts:150` -- `parseInt(lastEventIdHeader, 10)` with no NaN guard

## Proposed Solution
```ts
const parsed = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : undefined;
const reconnectCursor = (parsed !== undefined && !Number.isNaN(parsed)) ? parsed : undefined;
```

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Non-numeric Last-Event-ID treated as no cursor
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** HIGH
**Finding ID:** F06
