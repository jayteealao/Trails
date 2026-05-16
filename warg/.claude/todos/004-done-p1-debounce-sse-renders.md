---
status: done
priority: p1
issue_id: "004"
tags: [review-architecture, performance, high]
dependencies: []
---

# Full DOM re-render on every individual SSE event

## Problem Statement
Each `log` SSE event calls `renderDetailView()` which does a full `innerHTML` replacement. Initial batch of 30 events = 30 back-to-back DOM rebuilds with O(n^2) total work.

## Findings
- `pages/dashboard/modules/views/detail.js:64-68` -- `log` handler calls `renderDetailView()`
- `pages/dashboard/modules/views/detail.js:71-76` -- `state` handler also renders
- `pages/dashboard/modules/views/detail.js:116-178` -- `renderDetailView` does full innerHTML

## Proposed Solution
Debounce with `requestAnimationFrame`:
```js
let renderPending = false;
function scheduleRender() {
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; renderDetailView(); });
  }
}
```

## Acceptance Criteria
- [ ] Fix implemented
- [ ] No visible flicker during event bursts
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** HIGH
**Finding ID:** F04
