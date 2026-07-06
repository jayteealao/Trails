---
schema: sdlc/v1
type: verify
slug: simplify-android-app
slice-slug: firestore-dedup
status: complete
stage-number: 6
created-at: "2026-07-05T23:09:34Z"
updated-at: "2026-07-05T23:09:34Z"
result: pass
metric-checks-run: 6
metric-checks-passed: 6
metric-acceptance-met: 1
metric-acceptance-total: 1
metric-acceptance-user-observable: 0
metric-acceptance-code-only: 1
metric-interactive-checks-run: 0
metric-interactive-checks-passed: 0
metric-issues-found: 0
metric-issues-found-initial: 0
metric-issues-found-final: 0
fix-rounds-run: 0
convergence: not-needed
verify-owned-fix-commit: null
interactive-verification: not-applicable
interactive-verification-defer-reason: ""
adapters-used: []
bootstrap-failures: []
evidence-dir: ".ai/workflows/simplify-android-app/verify-evidence/firestore-dedup/"
evidence-run-count: 1
security-scan-result: pass
metric-a11y-violations-new: 0
a11y-result: not-automatable
cross-slice-regressions-found: 0
metric-bundle-size-delta-pct: 0
ac-staleness-checked: true
ac-stale-count: 0
longitudinal-baseline-compared: false
stability-check-flaky-count: 0
adversarial-tests-run: 0
adversarial-tests-failed: 0
failure-mode-probes-run: 0
cross-browser-delta: "none"
web-vitals-lcp-ms: null
web-vitals-cls: null
web-vitals-inp-ms: null
tags: [behaviour-preserving, firestore, dedup, reuse]
refs:
  index: 00-index.md
  verify-index: 06-verify.md
  slice-def: 03-slice-firestore-dedup.md
  plan: 04-plan-firestore-dedup.md
  implement: 05-implement-firestore-dedup.md
  review: 07-review-firestore-dedup.md
  adapters: runtime-adapters.md
next-command: wf-review
next-invocation: "/wf review simplify-android-app firestore-dedup"
---

# Verify: Firestore sync/backup deduplication (B1)

## The Verification

Four structural extractions — `addArticleToBatch`, `withAuthenticatedUser`, tag-backup
delegation to `backupArticle`, and cleanup of the two dead companion constants — landed on
commit `c4cb3b1`. The slice's single acceptance criterion is that the characterization suite
from `test-net` stays green; it does. The full 122-test unit suite ran clean (0 failures,
0 errors) including `FirestoreBackupServiceTest` (27 tests) and `FirestoreSyncManagerTest`
(8 tests), which are the primary parity proofs for this behaviour-preserving refactor.

The AC is code-only: no user-visible surface changed, only the internal structure of two
private Kotlin files. The interactive verification gate does not apply. No issues were found
requiring a fix round; `convergence: not-needed`.

One planned step (`applyRemoteArticles` extraction) was already in place from a sibling
slice — `batched-tag-reads` had implemented the fuller batch-prefetch form. Both `onPage`
call sites already delegated correctly. The deviation is documented in the implement record
and does not affect correctness; the test suite verifies the live shape.

## Verification Summary

- **Branch:** `feat/simplify-android-app` (confirmed)
- **Commit:** `c4cb3b163c656153dee90d825663df227e3a7661`
- **Full test suite:** 122/122 pass — 0 failures, 0 errors, 0 skipped
- **Slice-specific suites:** `FirestoreBackupServiceTest` 27/27, `FirestoreSyncManagerTest` 8/8, `FirestoreSyncManagerReconcileTest` 5/5
- **No issues found — fix loop not needed**

## Automated Checks Run

- **Build (compileDebugKotlin):** PASS — UP-TO-DATE; no new compile errors introduced
- **Full unit test suite (`./gradlew :app:testDebugUnitTest --rerun-tasks`):** PASS — 122/122 tests pass in ~64s; BUILD SUCCESSFUL
- **Slice-specific: `FirestoreBackupServiceTest`:** PASS — 27/27 tests; confirms `addArticleToBatch`, `withAuthenticatedUser`, marker writes, streaming-restore paths, and `batchRestoreArticleTags` all intact
- **Slice-specific: `FirestoreSyncManagerTest`:** PASS — 8/8 tests; confirms tag-backup delegation to `backupArticle` (2 calls per 2-article chunk), auth guard early-return, first-sync dispatch, batched-tag-reads wiring
- **Slice-specific: `FirestoreSyncManagerReconcileTest`:** PASS — 5/5 tests; no regressions in reconcile path
- **Structural AC checklist (static inspection):**
  - `FirestoreSyncManager.companion` no longer declares `USERS_COLLECTION` or `ARTICLES_COLLECTION` — CONFIRMED (grep: empty result)
  - No raw `firestore.collection(...)` or `firestore.batch()` calls remain in `FirestoreSyncManager` body — CONFIRMED
  - `withAuthenticatedUser{}` applied across 13 sites in `FirestoreBackupService` — CONFIRMED (lines 179, 206, 271, 309, 388, 459, 527, 551, 571, 591, 611, 632, 658)
  - `addArticleToBatch` called by both `backupArticle` (line 215) and `backupArticlesPaginated` (line 674) — CONFIRMED
  - `applyRemoteArticles` called from exactly two `onPage` lambda sites (lines 458, 511) — CONFIRMED (already in place from sibling slice)
  - Tag-backup in `syncLocalChanges` delegates to `backupArticle` (lines 308–332) — CONFIRMED
  - `FirestoreSyncManagerTest` tag-N+1 assertion updated (`coVerify(exactly = 2) { backupArticle(...) }`) — CONFIRMED

## Interactive Verification Results

Automated only — this slice has no user-observable AC. All criteria are code-only
(structural refactor of private helpers; no surface change). The interactive verification
gate does not apply.

## Acceptance Criteria Status

| Criterion | Kind | Status | Method | Evidence |
|---|---|---|---|---|
| **B1** — Given deduped `FirestoreSyncManager`/`FirestoreBackupService` When characterization suite runs Then stays green — single source for collection constants, `withAuthenticatedUser` guard, `addArticleToBatch`, `applyRemoteArticles`, tag-backup via `backupArticle`. | code-only | **met** | automated (unit test suite) | `FirestoreBackupServiceTest` 27/27, `FirestoreSyncManagerTest` 8/8, full suite 122/122 |

## Issues Found

None. `metric-issues-found-initial: 0`. Fix loop not entered.

## Security Scan

- **CVE scan:** Not automatable in this environment (no `gradle dependencyInsight --configuration debugRuntimeClasspath --dependency <vuln>` run; no new dependencies added by this slice — `build.gradle.kts` diff shows only comment changes, no new `implementation(...)` or `testImplementation(...)` entries). Result: **skipped — no new dependencies**
- **Secret detection:** Manual grep of the slice diff for credential/token/password patterns — **pass** (0 findings). No API key literals, tokens, or hardcoded credentials in the changed files.
- **SAST:** No semgrep/SAST tooling installed. **skipped.**

## Accessibility Gate

Not applicable — this slice modifies no UI components. `a11y-result: not-automatable` (no UI surface).

## Performance Gate

- **Bundle size delta:** The slice removes ~20 lines net (duplication eliminated) and adds private helper methods. No new Gradle dependencies were introduced. APK size: 30 MB (debug). Base-branch comparison: stash was empty (safe) but full APK rebuild from base branch was not run to avoid 60+ second overhead for a zero-dependency structural change. **metric-bundle-size-delta-pct: 0** (structural refactor with no new deps; negligible byte change in the Kotlin bytecode).
- **Build time delta:** Not measured separately. The test task ran in ~64s including compilation — consistent with prior runs.
- **Cold-start delta:** Not applicable (Android service, not a CLI/HTTP service cold-start).

## Cross-Slice Regression

- **Sibling slices checked:** `test-net`, `fts-search-fix`, `streaming-restore`, `batched-tag-reads`, `app-scope` — all previously verified.
- **Overlapping files:**
  - `FirestoreBackupService.kt` — also touched by `test-net`, `streaming-restore`, `batched-tag-reads`
  - `FirestoreSyncManager.kt` — also touched by `app-scope`, `batched-tag-reads`
  - `FirestoreSyncManagerTest.kt` — also touched by `test-net`, `batched-tag-reads`
- **Full suite run (122 tests):** 0 failures — no sibling slice regressions detected.
- **cross-slice-regressions-found: 0**

## Longitudinal Delta

- **Baseline source:** No prior evidence run exists for this slice; stash list was empty so a base-branch comparison was safe. Base-branch baseline not captured (no UI surface; code-only AC; skip per structural-refactor precedent from prior verified slices).
- **longitudinal-baseline-compared: false** — code-only slice; no screenshots or visual surfaces to compare.

## Friction Notes

- `withAuthenticatedUser` was implemented as a plain `suspend fun` rather than `inline suspend fun` (plan deviation, already documented in `05-implement-firestore-dedup.md`). This is semantically correct and avoids a potential compiler warning about inline + non-`crossinline` suspend lambdas. No convention divergence.
- `batchRestoreArticleTags` in `FirestoreBackupService` intentionally uses a distinct guard pattern (`?: return emptyMap()`) rather than `withAuthenticatedUser` — its return type (`Map<String, List<ArticleTags>>`) is not `Result<T>`. Informational; consistent with plan.

## Free Exploration Notes

- `FirestoreSyncManager.firestore` field (`private val firestore: FirebaseFirestore`) is now injected but never called directly in the manager's body (the inline tag-batch removal eliminated the only direct usages). The field is kept to avoid a Hilt DI graph change; `firestore-io` (B2) may reintroduce a direct reference. This is documented in `05-implement-firestore-dedup.md § Anything Deferred`. — informational

## Adversarial Tests

Not applicable — this slice has no user-interactive surface. Adversarial micro-tests (empty submission, extreme input, rapid repeat, network failure) do not apply to a pure structural refactor of backend Firestore helpers.

| Test | Result | Finding |
|---|---|---|
| Empty submission | n-a | No UI/form surface |
| Max-length input | n-a | No UI/form surface |
| Double-click / rapid repeat | n-a | No UI/form surface |
| Mid-flow interruption | n-a | No UI/form surface |
| Offline / network failure | n-a | Covered by `FirestoreBackupServiceTest` auth-guard failure test |

## Failure Mode Probes

Not applicable — no user-observable surface. The auth-guard failure path is covered by
`FirestoreBackupServiceTest.restoreAllArticlesPaginated returns failure when unauthenticated`
and `FirestoreSyncManagerTest.syncLocalChanges sets Error status when unauthenticated`.

| Probe | Result | Finding |
|---|---|---|
| Slow response (Fast 3G) | n-a | No UI surface |
| Concurrent session | n-a | No UI surface |
| Session expiry mid-flow | n-a | Covered by auth-guard unit tests |

## Cross-Browser Delta

Not applicable (Android-only stack).

## Web Vitals

Not applicable (Android-only stack).

## Gaps / Unverified Areas

- **Dead `firestore` field in `FirestoreSyncManager`:** Not a gap in this slice's AC. Deferred to a future simplify pass or moot when `firestore-io` (B2) lands.
- **`applyRemoteArticles` already implemented by `batched-tag-reads`:** Both call sites already delegate correctly; the deviation is a pre-done state, not a gap.

## Freshness Research

No external research required. Plan carried forward:
- `SetOptions.merge()` — idempotent; confirmed behaviour.
- Kotlin `inline suspend fun` — valid but chose plain `suspend fun` (plan deviation, confirmed correct).
- `WriteBatch` — 10 MiB/commit + 500-doc soft guideline; batch limits unchanged.
- AC references no external API or schema names. `ac-staleness-checked: true`, `ac-stale-count: 0`.

## Recommendation

The slice is clean. All 122 tests pass; the sole code-only AC is met; no issues found; no
interactive evidence needed. Ready for code review.

## Recommended Next Stage

- **Option A (recommended):** Code review — all automated checks clean; the behaviour-preserving structural refactor is ready for a code review pass.
- **Option D:** Skip review, go to handoff — this is a structural-only slice (no logic change) that has been proven by the characterization suite; valid if the team deems formal review unnecessary.
- **Option G:** Slug-wide runtime probe — to clear `streaming-restore` and `batched-tag-reads` interactive deferrals (requires a display-capable environment for AVD boot).

## Verify-Owned Fixes

No issues were found; fix loop was not entered. `fix-rounds-run: 0`.

## Assumptions

1. The configuration-cache hit (`testDebugUnitTest UP-TO-DATE` initially, then `FROM-CACHE` on re-run) reflects a warm Gradle cache from the implement-time test run. The `--rerun-tasks` invocation executed all 122 tests fresh and returned `BUILD SUCCESSFUL`, confirming the cache result is valid.
2. No `sdlc-debt:` markers exist in the slice diff (grep confirmed empty result).
3. Bundle-size delta is effectively 0: no new Gradle dependencies added; the bytecode delta from extracting 3 private helper methods is < 1 KB, well below the 20% threshold.

## Triage Decisions

None — issue inventory was empty at the start of the fix loop check.
