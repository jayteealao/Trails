---
schema: sdlc/v1
type: intake
slug: simplify-android-app
status: complete
revision-count: 0
stage-number: 1
created-at: "2026-06-14T18:14:48Z"
updated-at: "2026-06-14T18:14:48Z"
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  next: 02-shape.md
  source-triage: "../../simplify/20260613T0415Z.md"
next-command: wf-shape
next-invocation: "/wf shape simplify-android-app"
---

# Intake

## Restated Request
Act on the full triage of the Trails Android app (review-and-route run against
`android/app/src/main/java/com/jayteealao/trails`): 37 findings — 11 reuse, 13
quality, 13 efficiency — and turn them into shippable, incremental cleanup work.
Findings concentrate in the Firestore sync/backup layer (`FirestoreSyncManager`,
`FirestoreBackupService`, `ArticleRepository`) and the article-list UI
(`ArticleListItem`, `AdaptiveArticleGrid`). The triage includes one genuine logic
bug (quality-8: FTS `sanitizedQuery` computed then discarded) and two
resource-safety risks (efficiency-4: N+1 Firestore tag reads on restore;
efficiency-5: OOM from re-accumulating paginated restore into one list).

## Intended Outcome
Lower the app's maintenance cost (remove duplication, dead code, stringly-typed
keys, leaky abstractions) and runtime cost (Firestore round-trips, Room
transactions, Compose recomposition, memory) without changing user-visible
behaviour — except where a finding is an explicit fix (quality-8) or a
resource-safety improvement (efficiency-4/5).

## Primary User / Actor
The app's maintainer/developer (code health, reviewability, build/runtime cost)
and, indirectly, end users on low-memory devices and large libraries (restore
no longer OOMs; list scrolls without per-frame HTML parsing).

## Known Constraints
- Behaviour-preserving by default; the only intentional behaviour change is the
  FTS bug fix (quality-8) and the restore resource-safety work (efficiency-4/5).
- Two-stack monorepo: this work is **android/** only — do not touch the
  `warg/` Cloudflare stack. Firestore project `trails-e428e` is shared (Warg
  writes, Trails reads); efficiency-4 may need a composite index only, no rules
  changes if avoidable.
- Slug-wide review at the end; dedicated branch `feat/simplify-android-app`.

## Assumptions
- The triage's per-finding locations/line numbers are accurate as of the run
  date (2026-06-13); plan/implement should re-verify each before editing.
- The Tartlet Store / `combine()`→`stateIn()` ViewModel pattern stays; refactors
  conform to it rather than replacing it.
- Existing test infra (JUnit/Robolectric/MockK/Compose-UI-test) is the harness;
  new tests use it.

## Product Owner Questions Asked
- Branch strategy? Appetite? Review scope? (Batch A — answered)
- How to scope the 3 behaviour-changing items? (Batch A — answered: include all)
- Success criteria / non-goals / stack accuracy? (Batch B — proposed defaults,
  pending confirmation)

## Product Owner Answers
- Branch: **Dedicated** (`feat/simplify-android-app` off `main`).
- Appetite: **Large** — slice into incremental cleanups.
- Review scope: **Slug-wide**.
- Risky items: **Include all 3** (quality-8, efficiency-4, efficiency-5) as their
  own slices with acceptance criteria + tests.
- Batch B: proposed defaults captured in `po-answers.md`; `stack.user-confirmed`
  remains `false` pending confirmation in shape.

## Unknowns / Open Questions
- Does efficiency-4's batched/collectionGroup tag fetch require a new Firestore
  composite index (and does that need a deploy)? — resolve in plan.
- Acceptable shape of the streamed restore API for efficiency-5 (suspend
  callback vs Flow) — resolve in shape/plan with the call sites in view.
- Coil3 `allowHardware(true)` + palette extraction approach (efficiency-12):
  hardware-bitmap-safe palette path vs accept first-frame latency — resolve in plan.

## Dependencies / External Factors
- Firestore (batch write limits, collectionGroup indexing), Room (bulk DAO +
  transactions), Jetpack Compose (recomposition: `remember`/keys), Coil 3
  (`allowHardware`, palette), Kotlin coroutines (`Job.join`, structured scope).
- Source triage artifact: `.ai/simplify/20260613T0415Z.md` (read for per-finding
  locations, suggestions, and routing).

## Risks if Misunderstood
- Treating the whole set as pure mechanical cleanup would miss the real bug
  (quality-8) and the two resource-safety risks (efficiency-4/5).
- Changing the restore API (efficiency-5) without auditing all callers could
  break the restore worker.
- Over-eager "dedup" across the two Firestore services could collapse paths that
  are intentionally distinct — verify before merging.

## Success Criteria
1. All 37 findings resolved or explicitly deferred with a recorded reason.
2. No behavioural regressions: existing unit/UI tests stay green; new tests cover
   quality-8 (FTS sanitization) and the restore changes (efficiency-4/5).
3. Firestore sync/backup duplication removed (single source for tag-backup,
   collection constants, auth-guard, large-text handling); per-chunk batching and
   bulk Room ops replace per-item commits/deletes.
4. Article list does no per-recomposition HTML parsing and runs no dead
   animations; thumbnails decode efficiently.

## Out of Scope for Now
- New features; UI redesign; dependency upgrades.
- Any change to the `warg/` Cloudflare stack.
- Firestore security-rules changes (index-only if efficiency-4 needs it).

## Freshness Research
- Source: deferred to plan stage (per-slice). Why it matters: the recomposition
  fixes (Compose `remember`/`derivedStateOf`), Coil 3 hardware-bitmap palette
  handling, and Firestore batch/collectionGroup limits are version-sensitive and
  best verified against the pinned versions (Compose BOM 2025.09.00, Coil 3.3.0,
  firebase-bom 34.6.0) when each slice is planned. Takeaway: no external blocker
  for intake; flag a freshness check in `/wf plan` for the efficiency slices.

## Recommended Next Stage
- **Option A (default):** `/wf shape simplify-android-app` — Large appetite with
  37 findings across 3 dimensions plus 3 behaviour-changing items; shaping should
  define acceptance criteria per cluster and set up the slicing axis before plan.
- **Option B:** `/wf slice simplify-android-app` (skip shape) — viable only if you
  consider the triage artifact itself a sufficient spec; not recommended because
  the 3 behaviour-changing items need explicit AC.
- **Option C:** Blocked — none. Batch B answers are proposed defaults; they can be
  confirmed/amended during shape without blocking.
