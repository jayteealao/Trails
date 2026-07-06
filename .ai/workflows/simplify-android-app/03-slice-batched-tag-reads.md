---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: batched-tag-reads
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: [test-net]
tags: [behaviour-change, resource-safety, firestore, deploy-gated]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-test-net.md, 03-slice-streaming-restore.md, 03-slice-firestore-dedup.md]
  plan: 04-plan-batched-tag-reads.md
  implement: 05-implement-batched-tag-reads.md
---

# Slice: Batched tag reads on restore (efficiency-4)

## Goal
Eliminate the N+1 Firestore reads of the per-article `tags` subcollection during restore by
batching them, so total tag reads are sub-N+1.

## Why This Slice Exists
N+1 reads on restore is a resource/cost item the PO scoped as its own behaviour-changing slice.
It is **the only potentially deploy-gated slice**: the batched approach choice —
`collectionGroup` (needs a `COLLECTION_GROUP` composite index + a `rules_version='2'` wildcard
rules match on the shared `trails-e428e` project) **vs** chunked `whereIn` (client-only, capped
at 30 IDs/chunk) — and any deploy gating are **decided in this slice's plan** after inspecting
live rules and the tag-subcollection shape.

## Scope
- **In:** Replace per-article tag reads with a batched fetch. Decide collectionGroup-vs-whereIn
  in plan; if collectionGroup is elected, author + deploy + verify-live the composite index (and
  rules match) **before** this slice's code merges.
- **Out:** Any non-tag restore change (→ `streaming-restore`); write-path batching (→ `firestore-io`).
  No tag schema change.

## Acceptance Criteria
- **A3** — Given a bidirectional restore with N remote articles When tags are fetched Then total
  Firestore tag reads are sub-N+1 (batched). Verify read-count reduction via test/instrumentation.
  If a composite index or rules change is required, it is deployed + verified live per this slice's
  plan before merge. `automated` + `manual`

## Dependencies on Other Slices
- `test-net`: baseline for restore-path behaviour.
- Deploy gate (if collectionGroup): the shared-project index/rules change is its own gated step
  inside this slice's plan — handoff must not merge code ahead of a verified-live deploy.

## Risks
- Edge cases (shape): article with no tags; `>30` IDs (chunking for whereIn); a missing/denied tag
  read; **collectionGroup rules gap** — the query fails entirely if any candidate doc is uncovered
  by rules.
- Touches the shared `trails-e428e` project (warg writes, trails reads) — index/rules are the only
  permitted schema change in this whole workflow, and only if this plan elects collectionGroup.
- Constraint (freshness): `whereIn` cap is 30 values; collectionGroup requires index + rules v2.
