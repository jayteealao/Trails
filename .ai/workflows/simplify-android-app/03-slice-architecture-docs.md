---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: architecture-docs
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: [firestore-dedup, firestore-io, streaming-restore, batched-tag-reads, app-scope]
tags: [docs, diataxis]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-firestore-dedup.md, 03-slice-app-scope.md, 03-slice-batched-tag-reads.md]
  plan: 04-plan-architecture-docs.md
  implement: 05-implement-architecture-docs.md
---

# Slice: Diátaxis documentation (Definition-of-Done item 6)

## Goal
Deliver the full Diátaxis pass the PO scoped: reference + explanation docs for the refactored
sync/backup architecture and the new app-scope/DI conventions. No tutorial (audience is the maintainer).

## Why This Slice Exists
Docs are a DoD requirement and depend on the architecture being **settled** — so they land after
the slices that change it. Kept as a dedicated final slice (not folded into handoff) so the docs
are independently verifiable artifacts.

## Scope
- **In:**
  - **Explanation — "Firestore sync/backup architecture (post-cleanup)":** single-source collection
    constants, `withAuthenticatedUser` guard, `addArticleToBatch`/`applyRemoteArticles`, the streamed
    restore memory contract, and the batched-tag-read approach (incl. index/rules **iff**
    `batched-tag-reads` deployed collectionGroup). Must cover: the new shape and why; the
    streamed-restore memory contract; the FTS sanitization fix and its result-set impact.
  - **Explanation — "App-scope & DI conventions":** the new `@ApplicationScope @Singleton
    CoroutineScope(SupervisorJob()+dispatcher)`, when to use it vs `viewModelScope`, why bare
    `CoroutineScope(dispatcher)` is a reliability bug.
  - **Reference:** if `batched-tag-reads` deployed infra — document the `firestore.indexes.json`
    collectionGroup index + rules match (fields, scope, rationale). Else — a short reference note on
    the batched-tag-read query shape.
  - **README:** one line on the corrected FTS behaviour + the restore memory fix, if README surfaces
    app capabilities.
- **Out:** Per-line change logs (those live in the PR); warg internals; a Hilt tutorial.

## Acceptance Criteria
- Given the completed refactors When docs are written Then `docs/architecture/` (or repo docs root)
  contains the two explanation docs + the appropriate reference note, accurately describing the
  shipped architecture, with no internal workflow references (External Output Boundary). `manual` + review
- The reference index/rules doc exists **iff** `batched-tag-reads` elected + deployed collectionGroup;
  otherwise it is the client-only query-shape note.

## Dependencies on Other Slices
- `firestore-dedup`, `firestore-io`, `streaming-restore`, `batched-tag-reads`, `app-scope`: the
  architecture documented must be the **final** shipped shape. **Hard prerequisite — land last.**

## Risks
- Docs drift if written before the architecture settles — hence the dependency on the structural
  slices. The collectionGroup-vs-whereIn outcome from `batched-tag-reads` decides whether the
  index/rules reference doc exists at all.
- Leak check: keep all SDLC-workflow/artifact references out of the published docs.
