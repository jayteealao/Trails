---
schema: sdlc/v1
type: verify
slug: simplify-android-app
slice-slug: test-net
status: complete
stage-number: 6
created-at: "2026-06-18T22:41:59Z"
updated-at: "2026-06-18T22:41:59Z"
result: pass
metric-checks-run: 4
metric-checks-passed: 4
metric-acceptance-met: 2
metric-acceptance-total: 2
metric-acceptance-user-observable: 0
metric-acceptance-code-only: 2
metric-interactive-checks-run: 0
metric-interactive-checks-passed: 0
metric-issues-found: 0
metric-issues-found-initial: 0
metric-issues-found-final: 0
metric-preexisting-failures-isolated: 3
fix-rounds-run: 0
convergence: not-needed
verify-owned-fix-commit: null
interactive-verification: not-applicable
interactive-verification-defer-reason: ""
stack-source: confirmed
adapters-used: []
adapters-excluded-by-stack: []
bootstrap-failures: []
evidence-dir: ".ai/workflows/simplify-android-app/verify-evidence/test-net/"
evidence-run-count: 1
security-scan-result: pass
metric-a11y-violations-new: 0
a11y-result: not-automatable
cross-slice-regressions-found: 0
metric-bundle-size-delta-pct: "skipped"
ac-staleness-checked: false
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
tags: [test-infra, characterization, android]
refs:
  index: 00-index.md
  verify-index: 06-verify.md
  slice-def: 03-slice-test-net.md
  plan: 04-plan-test-net.md
  implement: 05-implement-test-net.md
  review: 07-review.md
  adapters: ${CLAUDE_PLUGIN_ROOT}/skills/wf/reference/runtime-adapters.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app fts-search-fix"
---

# Verify: Regression net — revive test infra + Firestore characterization

## Verification Summary

The regression-net slice **passes**. Both acceptance criteria are met and both are
code-only (test-only slice, zero production runtime change), so the user-observable
interactive gate does not apply. The slice's own targets are green and the revived
instrumented Hilt test module compiles. The only red in the full module suite is the
pre-existing `ArchiveServiceTest` trio, which this slice does not touch and is
provably not a regression from it.

- **Slice-attributable result:** all checks pass; no issues introduced.
- **23/23** target unit tests green; **`assembleDebugAndroidTest` BUILD SUCCESSFUL**.
- **3 pre-existing failures isolated** (`ArchiveServiceTest`) — out of scope, documented below.

## Automated Checks Run

- **Unit tests — slice targets** (`:app:testDebugUnitTest --tests *DefaultArticleRepositoryTest --tests *FirestoreBackupServiceTest --tests *FirestoreSyncManagerTest`): **BUILD SUCCESSFUL, 23/23 pass** (exit 0).
  - `DefaultArticleRepositoryTest` — 1 test, 0 failures.
  - `FirestoreBackupServiceTest` — 15 tests (8 pre-existing + 7 new), 0 failures.
  - `FirestoreSyncManagerTest` — 7 tests (new), 0 failures.
- **Unit tests — full module** (`:app:testDebugUnitTest`): **89 tests, 3 failed** (exit 1). The 3 failures are all `ArchiveServiceTest` (lines 100/116/134) — pre-existing on `main`, isolated below; not attributable to this slice.
- **Instrumented-test compile** (`:app:assembleDebugAndroidTest`): **BUILD SUCCESSFUL** — the revived `TestDatabaseModule` compiles and the Hilt test component graph is valid.
- **Static analysis / lint:** no detekt / ktlint / spotless is configured in the project (only AGP's built-in Android Lint); not run for a test-only diff. Kotlin type-correctness is enforced by the compile step (above), which succeeded.
- **Security scan:** secret-detection over the slice's added lines = clean (no credential/key/token literals). No new dependencies are introduced (the build-file diff *removes* two kapt registrations), so no new CVE surface. SAST (semgrep) not installed → skipped. `security-scan-result: pass`.

## Interactive Verification Results

Automated only — this is a test-only slice with no production change and no
user-observable acceptance criterion. Per the slice plan ("Interactive verification:
None required"), no runtime adapter was driven. `interactive-verification: not-applicable`.

## Acceptance Criteria Status

| # | Criterion (quoted) | kind | status | method | evidence |
|---|---|---|---|---|---|
| AC-1 | "`TestDatabaseModule` and `DefaultArticleRepositoryTest` compile and pass (E1)" | code-only | met | automated | `assembleDebugAndroidTest` SUCCESSFUL (module compiles) + `DefaultArticleRepositoryTest` 1/1 pass |
| AC-2 | "the characterization suite passes and asserts today's observable behaviour (write/commit shape, tag-backup, auth-guard, apply-remote)" | code-only | met | automated | `FirestoreBackupServiceTest` 15/15 + `FirestoreSyncManagerTest` 7/7 pass, pinning as-is behaviour |

Both AC partitioned as `code-only` (no visible surface, user action, or observable
post-condition requiring a live adapter). `metric-acceptance-user-observable: 0` → the
runtime-evidence gate did not fire.

## Issues Found

- **(pre-existing / out-of-scope, not a slice regression)** `ArchiveServiceTest` — 3 failing tests (`ArchiveServiceTest.kt:100`, `:116`, `:134`): "self-heals once on PERMISSION_DENIED then retries the read", "retries at most once and never crashes on repeated denial", "self-heal marker is written only for the denied item". These are `AssertionError`s in the archive read-path self-heal logic.
  - **Why it is not this slice's regression:** the slice diff is test-only and touches `ArchiveServiceTest` in no way. The single shared non-test file changed is `app/build.gradle.kts`, whose change only drops the redundant `kaptAndroidTest`/`kaptTest` Hilt-compiler registrations (Hilt now processed uniformly via KSP). `ArchiveServiceTest` is a pure MockK unit test (`@MockK` + `MockKAnnotations.init`, no `@HiltAndroidTest`/`@Inject`/Hilt rule), so Hilt annotation-processing changes cannot affect its assertions. The implement record independently confirmed identical failures on a clean `main` (stash-and-run).
  - **Disposition:** already flagged as a separate follow-up in `05-implement-test-net.md` → `## Anything Deferred`. No verify-stage action; left for a dedicated fix.

No slice-attributable issues → `metric-issues-found: 0`, fix loop not needed.

## Security Scan
- **CVE scan:** no new dependencies introduced (diff removes kapt registrations) — `skipped` (nothing new to scan); 0 new critical/high CVEs.
- **Secret detection:** `pass`, findings: none.
- **SAST:** `skipped` (semgrep not installed).

## Accessibility Gate
- **Tool used:** none — test-only slice, no UI surface introduced or modified. `a11y-result: not-automatable`.
- **New WCAG AA violations:** 0.

## Performance Gate
- **Bundle size delta:** `skipped` — test-only change; no production/shipping artifact is affected (the app APK is built from unchanged production sources).
- **Build time delta:** not measured — incremental; full target run ~26s, scoped re-run ~25s on a warm daemon.
- **Cold-start delta:** not-applicable (Android app; no service/CLI cold-start surface in this slice).

## Cross-Slice Regression
- **Sibling slices checked:** none — first slice implemented; no prior verified slices exist (`05-implement-*.md` siblings: none).
- **Regressions found:** 0.

## Longitudinal Delta
- Not applicable — no UI surface; no before/after screenshots. `longitudinal-baseline-compared: false`.

## Friction Notes
- None — no interactive drive.

## Free Exploration Notes
- Not applicable — no user surface to explore (test-only slice).

## Adversarial Tests
- Not applicable — no primary action surface to probe (test-only slice). `adversarial-tests-run: 0`.

## Failure Mode Probes
- Not applicable — no runtime flow to interrupt or throttle (test-only slice). `failure-mode-probes-run: 0`.

## Cross-Browser Delta
- Not applicable — non-web (Android).

## Web Vitals
- Not applicable — non-web (Android).

## Gaps / Unverified Areas
- **`:app:connectedDebugAndroidTest` (device-bound) was not run.** The revived `TestDatabaseModule` was validated by compile + Hilt component generation (`assembleDebugAndroidTest`), which is exactly the bar the slice AC sets ("the module compiles"). No instrumented test was revived in this slice; `PocketScreenTest`/`NavigationTest` remain out of scope.
- **Pre-existing `ArchiveServiceTest` failures (3)** remain red on the branch and on `main`. Tracked as a separate follow-up; does not gate this slice.

## Freshness Research
- Not required. Plan is 4 days old (`created-at: 2026-06-14`, well under the 14-day staleness window); the slice changes no external API integration (it characterizes Firestore behaviour via mocks). Test toolchain versions (MockK 1.14.5, coroutines-test 1.10.2, Hilt 2.57.1, Room 2.8.0, GMS `Tasks` stubs) were confirmed against the live build during implementation. `ac-staleness-checked: false`, `ac-stale-count: 0`.

## Recommendation

**PASS.** The regression net is green and load-bearing: the two disabled test-infra
files are revived and the Firestore sync/backup behaviour is pinned by 22 characterization
tests, establishing the behaviour-preserving baseline that `firestore-dedup`,
`firestore-io`, and `streaming-restore` will be held to. With `test-net` (the foundational
gate) verified, the dependent behaviour-changing slices may now proceed. Review is
slug-wide (`review-scope: slug-wide`) and is most valuable once those slices land, so the
practical next step is to continue implementation.

## Recommended Next Stage
- **Option B (recommended):** `/wf implement simplify-android-app fts-search-fix` — `test-net` is the foundational gate and it is green; the first behaviour-changing dependent slice may now proceed (it brings its own pinning tests).
- **Option A:** `/wf review simplify-android-app` — slug-wide review is available, but with 13 of 14 slices not yet implemented it is premature; defer until the behaviour-changing slices land so the review covers a meaningful diff.
- **Option D:** `/wf handoff simplify-android-app` — not yet; multi-slice work is incomplete.
- **Option G:** `/wf-quick probe simplify-android-app` — optional slug-wide runtime sweep; low value for a test-only gate with no runtime surface.
