---
schema: sdlc/v1
type: retro
slug: simplify-android-app
status: complete
stage-number: 10
created-at: "2026-07-11T08:44:42Z"
updated-at: "2026-07-11T08:44:42Z"
workflow-outcome: completed
learnings-written:
  - ../../solutions/testing/avd-headless-wall.md
  - ../../solutions/gotcha/mockk-suspend-lambda-ceiling.md
  - ../../solutions/process/triage-fix-invariant-regression.md
metric-improvement-count: 9
metric-stages-completed: 10
metric-stages-skipped: 0
tags: [refactor, android, cleanup, simplify, batch-ship]
refs:
  index: 00-index.md
next-command: ""
next-invocation: ""
---

# Retro

## The Retro

Fifteen slices, ten stages, zero blockers at ship — and the plan held: roughly 81% of ~109 planned steps executed as written, with zero scope creep across four weeks of work. The workflow's best structural decision was made at shape time: three genuinely undecidable specifics (batched-read approach, streaming API shape, palette handling) were explicitly deferred to plan, where code inspection answered all three definitively without a single PO round-trip — saving ~6 question cycles. The verify discipline also earned its keep once, catching 5 test-compile failures the app-scope implement pass missed after constructor changes.

The friction that mattered clusters into three findings, and the most damning is this: **the worst bug in the workflow was introduced by the review process itself.** A bot-suggested "hygiene" triage fix during handoff silently removed the Firestore 20-article budget-cap flush — an invariant documented in a comment right next to the code — and the existing test was updated to match the new behavior instead of catching the break (RE-3, HIGH, found only by the second full review run). The same handoff also paid a dismiss→re-encounter→fix cycle on a one-line threading fix. Meanwhile the AVD headless wall blocked 5 device-observable ACs across 4 slices, each discovered at verify time and resolved by retroactive PO override — a wall that should be classified at plan time and that one KVM emulator CI job would retire permanently.

The single highest-leverage repo fix surfaced by this retro costs one line: **PR CI never runs the unit tests.** `pr-build-check.yml` builds `assembleDebug` only, so the 143-test suite this workflow built runs nowhere but local machines — the fd2778e-era reconcile regression that forced the late 15th slice would have been caught pre-merge by `./gradlew test` in CI. Three durable learnings went into the new `.ai/solutions/` corpus; the deferred-debt harvest found two intentional `sdlc-debt:` ceilings (both acceptable) plus two act-now items, one already spawned as a background task.

## What Went Well
- **Plan fidelity:** ~81% of steps as-planned, 0 scope creep, 15/15 slices shipped; deviations were mostly legitimate discovery (5) or one-time stale assumptions (5).
- **Shape's "decide in plan" posture:** 3 open specifics resolved by code inspection at plan time, 0 PO round-trips — the strongest workflow-design decision of the project.
- **Verify as a real gate:** caught 5 compile failures after app-scope's constructor changes in one fix round; the AC gate forced honest deferral records instead of silent skips.
- **Review depth:** 14 dimensions, 2 runs, 25 findings all-time; 4 real correctness/reliability bugs fixed pre-merge (N+1 tag reads, stale first-sync double-read, CancellationException suppression, budget-cap regression).
- **Docs plan fulfilled exactly:** 3 architecture docs + README one-liner, matching shape's conditional plan precisely.
- **Batch ship worked:** the rca workstream joined cleanly at handoff rev-1; one atomic run shipped both slugs with a follower pointer.

## Friction / Failure Points
- **Triage-fix regression (RE-3, HIGH):** handoff-time bot-triage commit removed the documented 20-article Firestore budget-cap flush; the chunking test was updated to match rather than catch. Survived until review run 2.
- **AVD headless wall:** 5 device-observable ACs across 4 slices (streaming-restore, batched-tag-reads, list-rendering, sync-worker) undeliverable in headless sessions; all shipped on retroactive PO override.
- **MockK suspend-lambda ceiling hit twice:** documented in streaming-restore's deviations, not propagated to batched-tag-reads' plan; both slices fell back to weaker call-count assertions, and a bulk tag DAO bug slipped to review.
- **selfHealAttempts dismiss→re-encounter→fix:** a one-line AtomicInteger fix was deferred as "theoretical," re-raised by a second bot, then fixed anyway — costing a handoff revision and 6 extra CI watch rounds (16→22).
- **Implement didn't re-run the full suite after constructor changes** (app-scope): 5 compile failures deferred to verify that should have been zero-cost at implement.
- **Late 15th slice (reconcile-stall-guard):** the sync-worker pagination made a pre-existing stall bug reliably reproducible; with no unit tests in PR CI, the regression signal arrived via review/observation instead of a red check.

## Root Causes
- **PR CI runs no tests** — `pr-build-check.yml` does `assembleDebug` only; the entire 143-test suite is invisible to CI, so every regression signal arrives late (review, bots, or production).
- **Triage fixes bypass the invariant discipline** that slice implementation gets: no rule requiring a regression test for documented limits before landing a reviewer-suggested change.
- **Runtime-evidence ACs were designed without an environment check** — plan never asked "can this session boot a device?", so the wall was rediscovered per-slice at verify.
- **Tooling ceilings discovered mid-workflow don't flow back into unexecuted sibling plans** — no step re-opens later plans when an earlier slice's deviations name a shared limitation.

## Recommended Improvements
- **P0:** add `./gradlew --no-daemon test` to `pr-build-check.yml` (S) — single highest regression-prevention ROI; would have caught the reconcile regression pre-merge.
- **P1:** create `android/CLAUDE.md` (~80 lines) codifying: `@ApplicationScope` injection + the `cleanup()` no-cancel rule, `WRITE_BATCH_LIMIT = 20` rules-budget constraint, streaming-restore memory contract, `withAuthenticatedUser {}` guard, dispatcher-qualifier pattern; anti-patterns: ad-hoc `CoroutineScope(...)` in singletons, `delay()`-polling, unbatched Firestore reads in loops. Link the three `docs/architecture/*.md` files. (S)
- **P1:** KVM emulator job in CI (`reactivecircus/android-emulator-runner@v2`, ubuntu-latest, api 34 x86_64) running the existing `androidTest/` suite (M) — retires the AVD wall that has now taxed two workflows.
- **P2:** pin `firebase-tools` in `firebase-rules.yml` (`npm install -g firebase-tools@14`) + plan migration off deprecated `FIREBASE_TOKEN` to WIF (S install-pin, M auth-migration).
- **P2:** fix the git-cliff release step: replace `continue-on-error: true` with a loud `::warning::` annotation + job output so thin release notes can't ship silently (S). (v1.10.24 shipped with auto-notes; fixed manually in the announce phase.)
- **P2:** Roborazzi/Paparazzi JVM screenshot baseline for Compose screens (M) — covers visual-parity ACs without an emulator; additive to, not a substitute for, the KVM job.
- **P3:** prune `.claude/settings.local.json` (≈20 stale one-off allow entries) via `/fewer-permission-prompts`; promote durable patterns to project `.claude/settings.json` (S).

## Suggested Repo Instruction Updates
```md
<!-- android/CLAUDE.md (new file — key content) -->
# Trails Android — agent guide

Architecture references (read before touching sync/backup, DI, or tag reads):
- docs/architecture/firestore-sync-backup.md — WRITE_BATCH_LIMIT = 20 is tied to the
  Firestore rules getAfter() budget; any batch write path MUST flush on that cap.
- docs/architecture/app-scope-di.md — inject @ApplicationScope CoroutineScope; NEVER
  create `CoroutineScope(SupervisorJob() + Dispatchers.X)` inside a @Singleton, and
  NEVER call scope.cancel() on the injected app scope (cleanup() is a deliberate no-op).
- docs/architecture/batched-tag-reads.md — Firestore reads in loops must be chunked
  (async/awaitAll pattern, RESTORE_TAG_CHUNK_SIZE).

Conventions:
- Dispatchers are injected via @Dispatcher(TrailsDispatchers.IO|DEFAULT) qualifiers.
- Hilt modules live in */di/ and are named *Module.kt.
- All public FirestoreBackupService methods wrap in withAuthenticatedUser {}.
- Restore APIs stream pages via suspend onPage callbacks — never accumulate pages
  into a full-library List.
- Shared counters in @Singleton classes that launch coroutines use AtomicInteger.

Anti-patterns (each caused a real bug or review finding):
- delay()-polling for completion → use join / withTimeoutOrNull + Flow.first {}.
- Updating an existing test assertion in the same commit as the behavior change it
  guards.
- Mocking interfaces with suspend-lambda params (MockK can't drive them) → use fakes.
```

## Suggested Automation / Hook Opportunities
- PreToolUse hook (hookify, S): warn when an Edit introduces `scope.cancel()` under `services/firestore/` or `common/di/` — would have flagged the cleanup() regression class.
- CI annotation step for git-cliff failure (S) — see P2 above; pure CI, no Claude hook needed.
- Post-install `firebase --version` check after the pinned install in firebase-rules.yml (S).

## Suggested Test / CI Improvements
- `./gradlew test` in pr-build-check.yml (P0, S).
- KVM emulator job for `androidTest/` (P1, M) — also the retirement path for the 5 owed device smokes recorded in `runtime-evidence-deferrals`.
- Roborazzi golden baseline for list/detail screens (P2, M).
- Budget-cap regression test pattern: any test guarding a documented numeric limit should name the limit's source in a comment (e.g. `// firestore.rules getAfter() budget`), so "update the test to match" becomes visibly spec-breaking.
- Resolve the 3 pre-existing RED `ArchiveServiceTest` tests (act-now debt, below).

## Keep / Change / Drop
Keep:
- Shape's "decide in plan" deferral posture for code-inspectable specifics.
- The AC gate + honest `runtime-evidence-deferrals` records (the override needed ship-gate visibility, and got it).
- Batch handoff/ship for multi-workstream branches — one atomic PR run worked cleanly.
- test-net as slice 1 (characterization tests before refactoring) — even though two of its nets needed tightening, it anchored 14 subsequent slices.

Change:
- Plan stage: add an environment check for device-dependent ACs (defer-with-override decided BEFORE implement, not after).
- Triage fixes: invariant regression test required before landing; never co-commit an assertion change with the behavior change.
- Mid-workflow deviations that name tooling ceilings must trigger a re-read of unexecuted sibling plans.
- Implement completion checklist: full unit suite run AFTER the final file write, not mid-slice.

Drop:
- Retroactive PO-override round-trips at verify (superseded by the plan-time check).
- Dismissing one-line-fix bot findings as "theoretical" without evidence.

## Deferred Debt
| Marker (file:line) | Ceiling | Upgrade path | Recorded in | Disposition |
|---|---|---|---|---|
| sequential rehydration (FirestoreBackupService, restore page loop) | 50 serial large-text GETs per page | `async{}/awaitAll()` per page (idiom already in batchRestoreArticleTags) | 05-implement-streaming-restore.md ## Anything Deferred | accept — latency-gated, no user report |
| `RESTORE_TAG_CHUNK_SIZE = 10` | conservative chunk parallelism (max useful ~30) | raise the constant if profiling shows wall-clock benefit | 05-implement-batched-tag-reads.md ## Anything Deferred | accept — profiling-gated |
| `upsertNewArticle` resets `backedUpAt` to NULL on re-save (ArticleDao.kt:502) | one redundant re-upload per re-saved article | preserve stamp in merge-copy | reconcile-stall-guard audit | act-now — already spawned as background task |
| 3 pre-existing RED `ArchiveServiceTest` tests | failing tests mask real signal in that file | fix or quarantine with tracking | 05-implement-test-net.md follow-up note | act-now → `/wf intake fix "resolve 3 red ArchiveServiceTest tests"` |
| dead `firestore` field in FirestoreSyncManager; commented `computeContentMetrics()` | dead code only | future simplify pass | 05-implement-firestore-dedup.md / -sync-worker.md | accept |

## Learnings Written
- [.ai/solutions/testing/avd-headless-wall.md](../../solutions/testing/avd-headless-wall.md) — classify runtime-evidence ACs at plan time; KVM CI job retires the wall
- [.ai/solutions/gotcha/mockk-suspend-lambda-ceiling.md](../../solutions/gotcha/mockk-suspend-lambda-ceiling.md) — fakes over mocks for suspend-callback APIs; propagate ceilings to sibling plans
- [.ai/solutions/process/triage-fix-invariant-regression.md](../../solutions/process/triage-fix-invariant-regression.md) — regression-test documented invariants before landing triage fixes

## Recommended Next Stage
- **Option A (default):** Workflow complete — all 15 slices shipped in v1.10.24; retro closes the lifecycle.
- **Option B:** `/wf intake fix "resolve 3 pre-existing red ArchiveServiceTest tests"` — act-now debt; small, self-contained. (The backedUpAt-reset item already has a spawned background task.)
- **Option D:** Apply quick wins now — (1) `./gradlew test` step in pr-build-check.yml, (2) `android/CLAUDE.md` from the block above, (3) pin firebase-tools + git-cliff loud-failure. All S-effort; retro documents but does not apply them.
- **Post-ship obligation (outside lifecycle):** `/wf probe simplify-android-app <deferred-AC>` with a device attached — clears the 5 owed device smokes recorded in `runtime-evidence-deferrals`.
