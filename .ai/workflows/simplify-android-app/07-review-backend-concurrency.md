---
schema: sdlc/v1
type: review-command
slug: simplify-android-app
review-scope: slug-wide
slice-slug: ""
review-command: backend-concurrency
status: complete
updated-at: "2026-07-06T02:00:00Z"
metric-findings-total: 0
metric-findings-blocker: 0
metric-findings-high: 0
metric-findings-resolved: 0
result: clean
fragment: none
tags: []
refs:
  review-master: 07-review.md
---

# Review: backend-concurrency

## Summary

No concurrency issues found.

- `batchRestoreArticleTags`: uses `coroutineScope { chunks.map { async { ... } }.awaitAll() }` — correct structured parallel fan-out with no shared mutable state between coroutines; results collected via `awaitAll()` which re-throws any exception on the first failure.
- `addArticleToBatch`: single `WriteBatch` object passed through the call; Firestore `WriteBatch` is not thread-safe but it is used sequentially within each chunk — safe.
- `backupArticlesPaginated`: sequential chunk processing, one batch per chunk — no concurrent mutations.
- `_isSyncing` / `_syncStatus` / `_lastSyncTime` / `_lastError`: all `MutableStateFlow` which is thread-safe for concurrent writers; assignments are from a single coroutine at a time — safe.
- `RECONCILE_CHUNK_SIZE = 20` and `RESTORE_TAG_CHUNK_SIZE = 10` both respect the Firestore rules budget of ≤ 20 document-access calls per batched write.
- No shared mutable collections accessed from multiple coroutines concurrently.

## Findings

None. Dimension is clean.
