---
status: done
priority: p1
issue_id: "003"
tags: [review-architecture, api-contracts, blocker]
dependencies: []
---

# SSE event type `error` collides with built-in EventSource error

## Problem Statement
Server sends `event: error` which collides with the browser's built-in `EventSource.onerror` connection error. The client has no listener for this custom event -- diagnostics are silently lost.

## Findings
- `workers/logger/src/index.ts:170` -- `send('error', { message: 'Request not found' })`
- `pages/dashboard/modules/views/detail.js:82-86` -- only `onerror` (connection errors) is handled
- No `addEventListener('error', ...)` for the custom named event

## Proposed Solution
Rename to `stream-error` on server. Add client handler:
```js
eventSource.addEventListener('stream-error', (e) => {
  const data = JSON.parse(e.data);
  showError(data.message || 'Stream error');
  disconnectStream();
});
```

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Server-sent errors display to user
- [ ] No collision with built-in onerror
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** BLOCKER
**Finding ID:** F03
