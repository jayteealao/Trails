---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: firestore-io
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: [test-net, firestore-dedup]
tags: [behaviour-preserving, firestore, efficiency]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-firestore-dedup.md, 03-slice-test-net.md]
  plan: 04-plan-firestore-io.md
  implement: 05-implement-firestore-io.md
---

# Slice: Firestore read/write efficiency (B2)

## Goal
Reduce Firestore round-trips and Room op count on the sync/backup path with **the same outputs**:
one user-meta read, per-chunk batch commits, and a bulk tag-delete DAO call.

## Why This Slice Exists
After the layer is deduped (`firestore-dedup`), the efficiency wins (efficiency-1,2,3) sit on the
shared helpers (`addArticleToBatch`, `applyRemoteArticles`). Doing them after the dedup avoids
re-touching pre-dedup code and keeps each diff small and reviewable. Behaviour-preserving.

## Scope
- **In:**
  - **efficiency-1:** single user-meta read (cache/read once instead of repeatedly).
  - **efficiency-2:** per-chunk `WriteBatch` commit (chunk on the shared `addArticleToBatch`),
    keeping ~500-doc chunks for throughput hygiene (real cap is 10 MiB/commit, not 500 docs).
  - **efficiency-3:** bulk tag-delete via a `@Delete(List)` / `DELETE … WHERE parentId` DAO op
    instead of per-item deletes (Room auto-transactional for list ops).
- **Out:** Dedup/structure (→ `firestore-dedup`); N+1 tag reads on restore (→ `batched-tag-reads`);
  bulk `add()` on the repository (→ `article-repository`).

## Acceptance Criteria
- **B2** — Given the sync/backup path When it writes/reads Then it performs one user-meta read,
  commits per-chunk batches, and deletes tags in bulk — **same outputs, fewer ops** — and the
  `test-net` characterization suite stays green. `automated` + review

## Dependencies on Other Slices
- `firestore-dedup`: per-chunk commit builds on `addArticleToBatch`; user-meta read on the
  deduped guard. **Hard prerequisite.**
- `test-net`: parity baseline.

## Risks
- Batch chunking off-by-one or a partially-committed chunk on failure — verify atomicity
  expectations against the characterization suite.
- Bulk tag-delete must preserve cascade/parent semantics (Room: `DELETE … WHERE parentId`).
