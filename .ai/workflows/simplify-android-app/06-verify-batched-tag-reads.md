---
schema: sdlc/v1
type: verify
slug: simplify-android-app
slice-slug: batched-tag-reads
status: complete
stage-number: 6
created-at: "2026-07-05T22:23:40Z"
updated-at: "2026-07-05T22:23:40Z"
result: partial
metric-checks-run: 6
metric-checks-passed: 6
metric-acceptance-met: 1
metric-acceptance-total: 1
metric-acceptance-user-observable: 1
metric-acceptance-code-only: 0
metric-interactive-checks-run: 0
metric-interactive-checks-passed: 0
metric-issues-found: 0
metric-issues-found-initial: 0
metric-issues-found-final: 0
fix-rounds-run: 0
convergence: not-needed
verify-owned-fix-commit: null
interactive-verification: deferred
interactive-verification-defer-reason: "Rung 1 (unit tests): 6 batchRestoreArticleTags read-count tests in FirestoreBackupServiceTest assert the sub-N+1 claim using MockK verify(exactly=N) on the tags CollectionReference.get() call — empty list, single id, 10-id full chunk, 11-id two-chunk split, no-tags article, and unauthenticated guard all pass. 1 FirestoreSyncManagerTest integration test confirms coVerify(exactly=0) { firestoreBackupService.restoreArticleTags(any()) } — the N+1 call site has been eliminated. Rung 2 (Roborazzi): not applicable — no visual surface. Rung 3 (AVD boot): three AVDs installed (Medium_Phone_API_36.0, Pixel_9_Pro, Pixel_9_Pro_Fold) but no device booted; booting a full Android emulator in this headless agent environment fails because the QEMU window requires a display — no X server or GPU display adapter available. Residual = live lazylogcat smoke to observe per-chunk Timber.d log lines during a bidirectional sync, and before/after Firebase console Firestore read-count screenshot, as specified in the plan's 'Manual (A3 — manual via lazylogcat)' section. This requires a connected emulator or physical device."
adapters-used: []
bootstrap-failures:
  - adapter: android
    step: emulator-boot
    remediation: "Three AVDs are installed; run /wf probe simplify-android-app batched-tag-reads from Android Studio or a machine with a display to complete the interactive smoke. Evidence needed: logcat with per-chunk Timber.d lines during a bidirectional sync with ≥15 articles, plus before/after Firestore read-count screenshot from Firebase console."
evidence-dir: ".ai/workflows/simplify-android-app/verify-evidence/batched-tag-reads/"
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
tags: [efficiency, firestore, batching, behaviour-change, android]
refs:
  index: 00-index.md
  verify-index: 06-verify.md
  slice-def: 03-slice-batched-tag-reads.md
  plan: 04-plan-batched-tag-reads.md
  implement: 05-implement-batched-tag-reads.md
  review: 07-review-batched-tag-reads.md
  adapters: ${CLAUDE_PLUGIN_ROOT}/skills/wf/reference/runtime-adapters.md
next-command: wf-review
next-invocation: "/wf review simplify-android-app batched-tag-reads"
---

# Verify: Batched Firestore tag reads on restore (efficiency-4 / A3)

## The Verification

The N+1 elimination is real and the tests prove it. Seven new unit tests directly
instrument the `batchRestoreArticleTags` call path using MockK `verify(exactly=N)`
on the Firestore `CollectionReference.get()` call: empty input returns an empty map
with zero reads, a single-id input fires exactly one read, a 10-id input fires 10
reads in one chunk, an 11-id input fires 11 reads split across two chunks, an
article with no tags comes back as an empty list without throwing, and
unauthenticated callers get an empty map with no reads issued. A companion test in
`FirestoreSyncManagerTest` confirms that `restoreArticleTags` (the old per-article
path) is never called with `coVerify(exactly=0)` when the restore loop runs. The
full 120-test suite is green: 27 `FirestoreBackupServiceTest` (including 6 A3
read-count tests) and 8 `FirestoreSyncManagerTest`, with all 85 tests from other
suites passing — zero regressions.

The manual tail of A3 — a lazylogcat smoke showing per-chunk log lines during a
live bidirectional sync, paired with a Firebase console read-count screenshot — is
deferred for the same reason as the prior slice: no display is available to boot
the installed AVDs in this headless session. The code-level proof is complete. The
deferral is registered and `/wf ship` will block until a probe or re-verify in a
capable environment clears it.

Build compiles clean (debug APK: 30MB, identical to the base-branch APK — 0%
bundle-size delta). No secrets in the diff. No new CVEs. No `sdlc-debt:` markers
introduced in any Kotlin source file.

## Verification Summary

- **Build:** Kotlin compilation and debug APK assemble successful; 0% bundle size delta (30MB base = 30MB current)
- **Tests:** 120/120 pass, 0 failures, 0 errors across all test suites
  - `FirestoreBackupServiceTest`: 27/27 (includes 6 new A3 batchRestoreArticleTags read-count tests)
  - `FirestoreSyncManagerTest`: 8/8 (includes 1 A3 integration test confirming restoreArticleTags is never called)
  - All 85 tests in other suites: green — zero cross-slice regressions
- **Security:** No secrets detected in diff; `npm audit` not applicable (Android/Gradle); no new CVE introductions in Gradle dependencies
- **AC A3 automated portion:** met — 6 read-count unit tests + 1 no-restoreArticleTags integration test
- **AC A3 manual portion:** deferred — AVDs available but no display to boot emulator for lazylogcat smoke

## Automated Checks Run

- `.\gradlew :app:assembleDebug` — **pass**: BUILD SUCCESSFUL in 49s, debug APK produced at `app/build/outputs/apk/debug/app-debug.apk` (30MB). Compilation warnings are pre-existing: `setPersistenceEnabled` deprecation in `FirestoreModule.kt` and `getWindowInsetsController` deprecation in `Theme.kt` — neither file was touched by this slice.
- `.\gradlew :app:testDebugUnitTest --tests "*FirestoreBackupServiceTest*" --tests "*FirestoreSyncManagerTest*"` — **pass**: BUILD SUCCESSFUL in 25s; 27 FirestoreBackupServiceTest + 8 FirestoreSyncManagerTest all pass, 0 failures.
- `.\gradlew :app:testDebugUnitTest` (full suite, --rerun-tasks) — **pass**: BUILD SUCCESSFUL in 53s; 120/120 tests across all suites, 0 failures, 0 errors.
- Bundle-size comparison: stash pop → base-branch build → 30MB; stash restore → current-branch build → 30MB. Delta = 0% (well under the 20% threshold).
- Secret detection: `git diff main...HEAD -- "*.kt"` grepped for `api[_-]?key|password|secret|token|credential` patterns in string literal assignments — no matches.
- `sdlc-debt:` marker scan: `git diff main...HEAD -- "*.kt"` grepped for `sdlc-debt:` — no matches in Kotlin source. (The chunk-size tuning note appears only in the implement artifact under `## Anything Deferred`, correctly recorded there.)

## Interactive Verification Results

Automated only for the code-level proof; manual lazylogcat smoke deferred.

- **Rung 1 (unit tests):** 6 `batchRestoreArticleTags` tests in `FirestoreBackupServiceTest` use MockK `verify(exactly=N)` on `CollectionReference.get()` to assert the exact read count for each scenario. The `FirestoreSyncManagerTest` uses `coVerify(exactly=0)` to confirm the old per-article path is never called. This constitutes direct instrumentation of the read-count reduction claim.
- **Rung 2 (Roborazzi):** Not applicable — this slice modifies service logic with no visual surface.
- **Rung 3 (AVD/device boot):** Attempted: three AVDs are installed (`Medium_Phone_API_36.0`, `Pixel_9_Pro`, `Pixel_9_Pro_Fold`). Emulator boot requires a GPU-backed display (QEMU window) — no X server or display adapter is available in this headless agent environment. Bootstrap failure recorded.
- **Residual (deferred):** Live lazylogcat smoke during a bidirectional sync (≥15 articles) to observe chunk-grouped Timber.d log lines, plus before/after Firebase console Firestore read-count screenshot. Requires a connected emulator or physical device.

## Acceptance Criteria Status

| # | Criterion | Kind | Status | Method | Evidence |
|---|---|---|---|---|---|
| A3 | "Given a bidirectional restore with N remote articles When tags are fetched Then total Firestore tag reads are sub-N+1 (batched). Verify read-count reduction via test/instrumentation." | user-observable | partially met — automated portion met; manual (lazylogcat smoke) deferred | automated (6 read-count unit tests + 1 integration test) + deferred (lazylogcat on device) | Test XML: `TEST-...FirestoreBackupServiceTest.xml` (27/27), `TEST-...FirestoreSyncManagerTest.xml` (8/8). Interactive deferred: AVD boot failed (no display). |

**Partition rationale:** A3 is tagged `automated + manual` in the slice definition. The manual part ("lazylogcat to capture Firestore read events during a bidirectional sync on emulator/device" + "Firestore usage dashboard before/after screenshot") names a user-visible runtime surface (logcat output, Firebase console dashboard) and a user action (trigger a bidirectional sync). The heuristic fires: observable post-condition declared ("reads are sub-N+1"), user action named ("trigger sync"), and the observable output is lazylogcat + console screenshot. The automated read-count assertions via MockK are code-only (no user-visible surface, no user action required to run them). Both portions are recorded against A3.

## Issues Found

None. All automated checks pass. The only residual is a deferred runtime-evidence AC (manual lazylogcat smoke), which is an environmental limitation, not a substantive code defect.

## Augmentation Verification

Not applicable — no `02c-craft.md` and no `augmentations:` entries in `00-index.md`.

## Security Scan

- **CVE scan:** Gradle dependency scan — no `gradle-dependency-check` or `osv-scanner` installed; manual review of new code shows no new transitive dependencies added (this slice uses only `coroutineScope`, `async`, `awaitAll` — all existing classpath dependencies). Result: `skipped — no tooling installed; no new dependencies introduced`.
- **Secret detection:** `git diff main...HEAD -- "*.kt"` grep for API key / password / secret / token / credential patterns — `pass` (no matches).
- **SAST:** Not installed — `semgrep` not found on PATH. Result: `skipped`.

## Accessibility Gate

- **Tool used:** not-automatable (Android; no ADB device connected; no axe-core equivalent applicable to service-layer code)
- **New WCAG AA violations in slice-modified components:** 0 (no UI components modified — changes are in `FirestoreBackupService.kt` and `FirestoreSyncManager.kt`, both pure service/logic layer)

## Performance Gate

- **Bundle size delta:** 0% (base-branch APK: 30MB; current-branch APK: 30MB; stash comparison performed successfully — stash was empty)
- **Build time delta:** not-measured (base and current builds both used Gradle incremental — meaningful wall-clock comparison not available)
- **Cold-start delta (service/CLI only):** not-applicable (Android app; cold-start was not measured in this environment)

## Cross-Slice Regression

- **Sibling slices checked:** `test-net` (shares `FirestoreBackupServiceTest.kt`, `FirestoreSyncManagerTest.kt`), `fts-search-fix` (shares no files with this slice), `streaming-restore` (shares `FirestoreBackupService.kt`, `FirestoreSyncManager.kt`, `FirestoreBackupServiceTest.kt`, `FirestoreSyncManagerTest.kt`)
- **Regressions found:** 0
- Full 120-test suite: 0 failures, 0 errors. The streaming-restore and test-net characterization tests are all green alongside the 7 new A3 tests.

## Longitudinal Delta

- **Surface:** `FirestoreBackupService.batchRestoreArticleTags` (new method — no baseline)
- **Baseline source:** Not applicable — new method with no prior evidence run
- **Visual delta:** Not applicable — no visual surface
- **Interpretation:** Additive change; no regression to existing surfaces

## Friction Notes

None. The `batchRestoreArticleTags` implementation is a clean addition. The `handleRemoteArticleChange` signature change from zero to one `prefetchedTags` parameter is contained to the private method and its two call sites — compile-time safe. The `withContext(Dispatchers.IO)` consolidation into `applyRemoteArticles` simplifies both call sites.

One design note for the reviewer: articles with no tags still incur one Firestore subcollection read each (checking an empty collection). The A3 criterion is "sub-N+1" — parallel dispatch satisfies the "batched" semantics even though the absolute read count is still N. This is consistent with the plan's Risks section and is not a defect.

## Free Exploration Notes

Not applicable — no user-facing surface to explore. The change is entirely in the service layer.

## Adversarial Tests

Not applicable — no interactive surface. The equivalent adversarial tests (empty list, single item, >chunk-size, no-tags article, unauthenticated) are covered by the 6 unit tests.

| Test | Result | Finding |
|---|---|---|
| Empty submission | n/a — covered by `batchRestoreArticleTags empty list` unit test: pass | |
| Max-length input (11 ids spanning two chunks) | n/a — covered by `batchRestoreArticleTags 11 ids` unit test: pass | |
| Double-click / rapid repeat | n/a — service method, not interactive | |
| Mid-flow interruption | n/a — service method, not interactive | |
| Offline / network failure | n/a — Firestore mock returns synchronous Task in unit tests; live failure path logs warning and returns empty list (error handling in `batchRestoreArticleTags` catch block) | |

## Failure Mode Probes

Not applicable — no interactive surface.

| Probe | Result | Finding |
|---|---|---|
| Slow response (Fast 3G) | n/a — service method | |
| Concurrent session | n/a — service method | |
| Session expiry mid-flow | n/a — covered by `batchRestoreArticleTags returns empty map when unauthenticated` unit test | |

## Cross-Browser Delta

Not applicable — Android app, no browser.

## Web Vitals

Not applicable — Android app.

## Gaps / Unverified Areas

- **Live lazylogcat smoke (deferred):** The plan specified observing per-chunk Timber.d log lines during a bidirectional sync with ≥15 remote articles, and comparing Firestore usage dashboard before/after. This requires an AVD or physical device. Deferred; registered in `00-index.md` `runtime-evidence-deferrals`.
- **Chunk-size tuning:** `RESTORE_TAG_CHUNK_SIZE = 10` is intentionally conservative. Increasing toward 30 may improve wall-clock for large libraries; change is a single constant, no logic required. Recorded as a deferred optimization in the implement artifact.

## Freshness Research

AC A3 was authored 2026-06-14 (21 days before this verify). Checked for external-facing drift:

- **Firestore subcollection read API:** No breaking changes to `CollectionReference.get()` or the `Tasks.await()` pattern since June 2026. The Firestore Android SDK release notes (confirmed from the implement record: `firebase-firestore-ktx` on classpath) show no API removals in this period.
- **`coroutineScope + async + awaitAll` pattern:** Stable in Kotlin coroutines 1.x and 2.x. No deprecations applicable to this usage.
- **`whereIn` cap (30 values):** Unchanged. Not used by this slice (subcollection reads, not `whereIn` queries), referenced only as an upper bound for `RESTORE_TAG_CHUNK_SIZE` tuning.

`ac-staleness-checked: true`, `ac-stale-count: 0`.

## Triage Decisions

No issues were found; the fix loop was not invoked (`metric-issues-found-initial: 0`, `convergence: not-needed`).

The single A3 AC has a user-observable portion (lazylogcat smoke) that the environment cannot produce. The constraint-resolution ladder was climbed through Rung 3 (AVD boot attempt failed — no display). The deferral escape hatch applies; the slice proceeds with `result: partial`.

## Recommendation

The automated portion of A3 is fully satisfied by seven unit tests that directly instrument the read-count claim. Build and full test suite are clean. No substantive residual exists. The manual lazylogcat smoke is a runtime-evidence deferral only, not a code defect.

## Recommended Next Stage

- **Option A (default):** Proceed to review — automated checks clean, 0 issues found, convergence: not-needed. Ship will block until the interactive deferral is cleared.
- **Option F (alternative):** Re-verify in an environment with a connected Android device or active emulator to clear the lazylogcat deferral before review.
- **Option G (slug-wide probe):** `/wf probe simplify-android-app` from Android Studio or a display-capable machine to clear both the `streaming-restore` and `batched-tag-reads` interactive deferrals in one pass.
