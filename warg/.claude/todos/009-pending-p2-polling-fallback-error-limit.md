---
status: pending
priority: p2
issue_id: "009"
tags: [review-architecture, scalability, med]
dependencies: []
---

# Polling fallback retries forever with no error limit

## Problem Statement
The `catch {}` in `startDetailPoll` silently swallows all errors. Deleted requests or downed Logger cause infinite 3s polling.

## Findings
- `pages/dashboard/modules/views/detail.js:40-41` -- `catch { /* silent */ }`

## Proposed Solution
Add consecutive error counter. After 5 failures, stop polling and show "Connection lost - refresh to retry".

## Acceptance Criteria
- [ ] Fix implemented
- [ ] User sees error after repeated failures
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** MED
**Finding ID:** F09
