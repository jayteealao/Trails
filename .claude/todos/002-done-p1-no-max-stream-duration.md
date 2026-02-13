---
status: done
priority: p1
issue_id: "002"
tags: [review-architecture, scalability, blocker]
dependencies: []
---

# No maximum stream duration on SSE connections

## Problem Statement
The SSE poll loop has no timeout. If a request never reaches terminal state, the connection stays open until Workers runtime kills it (~15 min). Browser auto-reconnects, creating infinite 15-min cycles, each holding 2 worker instances.

## Findings
- `workers/logger/src/index.ts:208-244` -- `while (!abortFlag.stopped)` loop with no duration limit
- Only exits on: client disconnect, terminal state, or null DO response
- Stuck requests are exactly the ones operators leave open to watch

## Proposed Solution
Add `MAX_STREAM_MS = 2 * 60 * 1000`. Track elapsed time. When exceeded, send `timeout` event and close. Browser reconnects via `Last-Event-ID`.

## Acceptance Criteria
- [ ] Fix implemented
- [ ] Streams close after max duration
- [ ] Browser reconnects seamlessly with Last-Event-ID
- [ ] No regressions

## Work Log
### 2026-02-12 - Created from Review
**Source:** /review:architecture
**Severity:** BLOCKER
**Finding ID:** F02
