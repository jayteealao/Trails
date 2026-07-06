---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: firestore-dedup
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: l
depends-on: [test-net, app-scope]
tags: [behaviour-preserving, firestore, dedup]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-test-net.md, 03-slice-app-scope.md, 03-slice-firestore-io.md]
  plan: 04-plan-firestore-dedup.md
  implement: 05-implement-firestore-dedup.md
---

# Slice: Firestore sync/backup deduplication (B1)

## Goal
Collapse the duplication across `FirestoreSyncManager` and `FirestoreBackupService` to single
sources, with **behaviour identical** to today — pinned by the characterization tests from
`test-net`.

## Why This Slice Exists
The sync/backup layer has the heaviest duplication in the codebase (5 reuse findings + quality-3).
Consolidating it is the core maintenance-cost win. It is strictly behaviour-preserving, so it
lands **after** the net (`test-net`) and after the scope consolidation (`app-scope`) it sits on.

## Scope
- **In (reuse-1,2,3,4,7 + quality-3):**
  - Collection-name constants in one place (companion object on `FirestoreBackupService`).
  - `withAuthenticatedUser { }` auth-guard helper replacing repeated inline guards.
  - `addArticleToBatch(...)` extraction.
  - `applyRemoteArticles(...)` (chunked-apply) helper.
  - Tag-backup delegated to `backupArticle` (single source).
- **Out:** I/O-efficiency changes (single user-meta read, per-chunk commit, bulk tag-delete →
  `firestore-io` / B2); the N+1 tag-read fix (→ `batched-tag-reads`); streamed restore (→
  `streaming-restore`). This slice changes **structure, not behaviour**.

## Acceptance Criteria
- **B1** — Given the deduped `FirestoreSyncManager`/`FirestoreBackupService` When the
  characterization suite (from `test-net`) runs Then it stays green — behaviour is identical:
  single source for collection constants, `withAuthenticatedUser` guard, `addArticleToBatch`,
  `applyRemoteArticles`, and tag-backup via `backupArticle`. `automated` + review

## Dependencies on Other Slices
- `test-net`: the characterization baseline that proves parity — **hard prerequisite**.
- `app-scope`: SyncManager's scope is already consolidated, so dedup edits the post-scope code.

## Risks
- Over-eager dedup could collapse paths that are **intentionally distinct** between the two
  services — verify each merge against the characterization suite before committing (shape risk).
- Touches the same two files as `firestore-io` — sequence B1 before B2 (B2's per-chunk commit
  builds on `addArticleToBatch`).
