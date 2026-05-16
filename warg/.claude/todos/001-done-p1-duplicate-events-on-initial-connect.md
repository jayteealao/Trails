---
status: done
priority: p1
issue_id: "001"
tags: [review-architecture, api-contracts, blocker]
dependencies: []
---

# Duplicate events on initial connect

## Problem Statement
Every non-terminal request shows each event twice in the timeline UI. `loadRequestDetail()` fetches all events via `fetchRequestDetail`, then `connectStream()` re-sends them via SSE `log` events. The `log` handler `.push()`es onto the existing array.

## Findings
- `pages/dashboard/modules/views/detail.js:101` -- fetches full view with all events
- `pages/dashboard/modules/views/detail.js:107` -- opens SSE stream
- `pages/dashboard/modules/views/detail.js:60` -- `init` handler shallow-merges, preserving existing events
- `pages/dashboard/modules/views/detail.js:66-67` -- `log` handler pushes duplicates
- `workers/logger/src/index.ts:185` -- server sends all events from cursor=undefined

## Proposed Solution
Reset events in the `init` handler:
```js
eventSource.addEventListener('init', (e) => {
  const data = JSON.parse(e.data);
  state.selectedRequest = { ...state.selectedRequest, ...data, events: [] };
  renderDetailView();
});
```

## Acceptance Criteria
- [ ] Fix implemented
- [ ] No duplicate events in timeline after opening detail view
- [ ] No regressions on SSE reconnection

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** BLOCKER
**Finding ID:** F01
