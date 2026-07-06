---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: test-net
status: defined
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: []
tags: [test-infra, characterization]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-firestore-dedup.md, 03-slice-firestore-io.md, 03-slice-fts-search-fix.md, 03-slice-streaming-restore.md]
  plan: 04-plan-test-net.md
  implement: 05-implement-test-net.md
---

# Slice: Regression net — revive test infra + Firestore characterization

## Goal
Stand up a green safety net **before any refactor lands**: revive the disabled Hilt
test module and repository test, and pin the current behaviour of the Firestore
sync/backup layer with characterization tests so the dedup refactors (firestore-dedup,
firestore-io) can be proven behaviour-preserving.

## Why This Slice Exists
The PO chose **characterization-tests-first** and a **dedicated test-net slice** so the
net is an explicit, verifiable gate rather than work smuggled into the first refactor.
The dedup slices (B1/B2) cannot claim "behaviour identical" without a baseline that
captures today's behaviour. This slice is the prerequisite that makes that claim checkable.

## Scope
- **In:**
  - Revive `src/androidTest/.../testdi/TestDatabaseModule.kt` (E1) so Hilt-backed DB tests run.
  - Revive `src/test/.../data/DefaultArticleRepositoryTest.kt` (E1) — repair only what the
    net requires; do not expand it speculatively.
  - Write characterization tests pinning **current** `FirestoreSyncManager` and
    `FirestoreBackupService` behaviour (the surfaces B1/B2 will refactor): backup batching,
    tag-backup, auth-guard paths, apply-remote, user-meta read.
- **Out:**
  - The FTS tests (live with `fts-search-fix`), streaming-restore tests (`streaming-restore`),
    tag-read-count test (`batched-tag-reads`), supervised-scope test (`app-scope`), and Compose
    UI tests (`list-rendering`). Each new-behaviour test ships with the slice that changes it.
  - Any production-code change. This slice is test-only.

## Acceptance Criteria
- Given the project's test harness When CI/test suite runs Then `TestDatabaseModule` and
  `DefaultArticleRepositoryTest` compile and pass (E1). `automated`
- Given the **current** (pre-refactor) `FirestoreSyncManager`/`FirestoreBackupService` When
  the characterization suite runs Then it passes and asserts today's observable behaviour
  (write/commit shape, tag-backup, auth-guard, apply-remote) — establishing the baseline that
  firestore-dedup/firestore-io must preserve. `automated`

## Dependencies on Other Slices
- None — this is the foundational gate. `firestore-dedup` and `firestore-io` depend on it.

## Risks
- Reviving infra may surface why it was disabled (compile drift, Hilt graph changes). Repair
  scope is bounded to "what the net requires" — if revival balloons, record a deferral with reason.
- Characterization tests must pin behaviour **as-is**, including any current quirks, so the
  refactors are held to true parity — do not "fix" behaviour here.
