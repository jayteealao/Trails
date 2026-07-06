---
schema: sdlc/v1
type: slice-index
slug: simplify-android-app
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
total-slices: 14
best-first-slice: test-net
tags: [refactor, android, cleanup, simplify]
slices:
  - slug: test-net
    status: defined
    complexity: m
    depends-on: []
  - slug: fts-search-fix
    status: defined
    complexity: s
    depends-on: [test-net]
  - slug: streaming-restore
    status: defined
    complexity: l
    depends-on: [test-net]
  - slug: batched-tag-reads
    status: defined
    complexity: m
    depends-on: [test-net]
  - slug: app-scope
    status: defined
    complexity: s
    depends-on: [test-net]
  - slug: firestore-dedup
    status: defined
    complexity: l
    depends-on: [test-net, app-scope]
  - slug: firestore-io
    status: defined
    complexity: m
    depends-on: [test-net, firestore-dedup]
  - slug: article-repository
    status: defined
    complexity: s
    depends-on: [test-net, app-scope]
  - slug: detail-viewmodel
    status: defined
    complexity: m
    depends-on: []
  - slug: list-viewmodel
    status: defined
    complexity: s
    depends-on: [article-repository]
  - slug: list-rendering
    status: defined
    complexity: m
    depends-on: []
  - slug: sync-worker
    status: defined
    complexity: m
    depends-on: []
  - slug: cross-cutting-url
    status: defined
    complexity: s
    depends-on: []
  - slug: architecture-docs
    status: defined
    complexity: m
    depends-on: [firestore-dedup, firestore-io, streaming-restore, batched-tag-reads, app-scope]
refs:
  index: 00-index.md
  shape: 02-shape.md
next-command: wf-plan
next-invocation: "/wf plan simplify-android-app test-net"
---

# Slice Index

14 slices decompose the 37 triage findings (11 reuse, 13 quality, 13 efficiency) plus the three
PO-scoped extras (revive test infra, remove deprecated `restoreAllArticles()`, broaden quality-11).
Axis = **by code area**; order = **risky-3-first**, behind a test-net gate.

## Slice Strategy
The shape pre-clustered the findings (E1, A1–A4, B1–B9). The slice discovery resolved the four
*seam* decisions — where behaviour-changing and behaviour-preserving work land on the same files:

1. **Test net is its own slice and lands first** (`test-net` = E1 + Firestore characterization).
   Nothing refactors until the net is green. This is the best-first slice and a hard prerequisite
   for both the FTS fix and the Firestore dedup/IO slices.
2. **The risky three stay isolated, one slice each, ahead of the cleanups:** `fts-search-fix` (A1),
   `streaming-restore` (A2+A2b, with the deprecated `restoreAllArticles()` removal folded in),
   `batched-tag-reads` (A3, the only deploy-gated slice), and `app-scope` (A4, foundational DI).
3. **The Firestore layer is sliced thin** into four: A2, A3 (risky), then `firestore-dedup` (B1) and
   `firestore-io` (B2) (preserving) — B2 sits on B1's extracted helpers.
4. **ArticleRepository is split:** the one behaviour change (`fts-search-fix`/A1, `searchWithScore`)
   is isolated from the preserving cleanup (`article-repository`/B3, `delete()`/`add()`). `app-scope`
   lands before B3 since both edit the repo constructor.
5. **B6+B8 are one slice** (`list-rendering`): removing the dead gradient (B6) may delete B8's only
   palette consumer, so the palette/`allowHardware` decision is made in one place after tracing.

The remaining areas (`detail-viewmodel` B4, `list-viewmodel` B5, `sync-worker` B7, `cross-cutting-url`
B9) are clean single-area slices. `architecture-docs` is the final slice — it documents the settled
architecture (DoD item 6).

## Recommended Order
1. `test-net` — stand up the regression net (gate; everything depends on it).
2. `fts-search-fix` — A1, the one logic bug; isolated, behaviour-changing.
3. `streaming-restore` — A2/A2b, OOM resource-safety; risky.
4. `batched-tag-reads` — A3, N+1 reads; risky **and** the only deploy-gated slice.
5. `app-scope` — A4, supervised app-scope; foundational for B1/B3.
6. `firestore-dedup` — B1, the heaviest dedup; needs the net + app-scope.
7. `firestore-io` — B2, efficiency on the deduped helpers; needs B1.
8. `article-repository` — B3, preserving repo cleanup; needs app-scope.
9. `detail-viewmodel` — B4, independent area (can parallelize).
10. `list-viewmodel` — B5, broadened DAO-behind-repo; needs B3.
11. `list-rendering` — B6+B8, recomposition + thumbnail; independent.
12. `sync-worker` — B7, worker glue; independent.
13. `cross-cutting-url` — B9, single-source URL; conflict-prone, land when neighbours settle.
14. `architecture-docs` — Diátaxis docs; needs the structural slices done.

## Cross-Cutting Concerns
- **Behaviour-preserving by default.** Only `fts-search-fix`, `streaming-restore` (+A2b),
  `batched-tag-reads`, and `app-scope` intentionally change behaviour. Everything else is held to
  parity by the `test-net` characterization suite + existing tests.
- **Hard cutover** for every internal-signature change — all callers updated within the same slice.
- **android/ only.** The single permitted shared-project (`trails-e428e`) change is an index (+ rules)
  **iff** `batched-tag-reads` elects collectionGroup — gated in that slice's plan.
- **Per-slice risk bar** scaled to blast radius (a Firestore-sync change ≠ a dead-code deletion).
- **Slug-wide review** at handoff over the whole branch diff.

## Dependencies Between Slices
- `test-net` → (gates) `fts-search-fix`, `streaming-restore`, `batched-tag-reads`, `firestore-dedup`,
  `firestore-io`.
- `app-scope` → `firestore-dedup`, `article-repository` (shared constructors / consolidated scope).
- `firestore-dedup` → `firestore-io` (B2 builds on `addArticleToBatch`).
- `article-repository` → `list-viewmodel` (stable repo surface for the broadened DAO-behind-repo move).
- `firestore-dedup`, `firestore-io`, `streaming-restore`, `batched-tag-reads`, `app-scope` →
  `architecture-docs` (documents the final shape).
- Independent (parallelizable any time): `detail-viewmodel`, `list-rendering`, `sync-worker`,
  `cross-cutting-url` (latter is conflict-prone — sequence near its neighbours).

## Deferred / Optional Slices
- None deferred at slice time. Deferrals are **allowed with a recorded reason** if a finding proves
  riskier/larger than triaged — recorded per-slice during plan/implement.
- `batched-tag-reads` may stay client-only (chunked `whereIn`), in which case the
  `architecture-docs` index/rules reference doc is dropped to a query-shape note.

## Freshness Research
- Carried from `02-shape.md` (Firestore collectionGroup index/rules + `whereIn` 30 cap, WriteBatch
  10 MiB limit, Room 2.8 list-ops auto-transactional, Coil 3 per-request `allowHardware`, Compose
  `remember`/`derivedStateOf`, supervised app-scope). No new external constraint affects slicing.
- The only slicing-relevant external constraint — the A3 deploy gate — is isolated into its own
  slice (`batched-tag-reads`) with the decision deferred to its plan, as the shape directed.

## Recommended Next Stage
- **Option A (default):** `/wf plan simplify-android-app test-net` — plan the best-first gate slice;
  the rest of the chain depends on it being green.
- **Option B:** `/wf plan simplify-android-app all` — plan all 14 slices in parallel. Viable given
  the clean DAG, but the dependency edges (esp. test-net → everything, app-scope → B1/B3) mean
  best-first sequencing is lower-risk.
- **Option C:** `/wf shape simplify-android-app` — revisit shape. Not recommended; the spec
  decomposed cleanly with no contradictions surfaced.
