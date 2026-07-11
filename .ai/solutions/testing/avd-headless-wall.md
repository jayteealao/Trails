---
schema: sdlc/v1
type: solution
category: testing
source-workflow: simplify-android-app
created-at: "2026-07-11T08:44:42Z"
tags: [avd, emulator, headless, runtime-evidence, deferral, android, verify, device-smoke]
status: active
---

# AVD headless wall — no device-observable AC is verifiable in agent sessions

## Problem
Agent sessions on this machine have no display server/GPU, so installed AVDs
(Medium_Phone_API_36.0, Pixel_9_Pro, Pixel_9_Pro_Fold) cannot boot — QEMU needs a
display. Every AC of the form "install the APK and observe behavior" hits this wall.
It blocked 5 ACs across 4 slices in simplify-android-app and 1 more in
rca-saved-articles-no-archives; all 5 deferrals ultimately shipped in v1.10.24 on
explicit PO override instead of evidence.

## Learning
The wall is environmental and permanent for headless sessions — discovering it at
verify time and requesting a retroactive PO override is pure waste. Runtime-evidence
ACs must be classified at PLAN time: either (a) pre-declare the deferral + residual
device smoke with PO sign-off before implement starts, or (b) rewrite the AC with a
JVM-verifiable fallback (Robolectric, emulator-rules tests, Roborazzi previews).

## How to apply
- In `/wf plan`, when an AC needs a booted device, immediately ask the PO: defer-with-
  override now, or reshape the AC.
- The one-time harness that retires the wall: a KVM emulator job in CI
  (`reactivecircus/android-emulator-runner@v2` on ubuntu-latest, api 34 x86_64) running
  the existing `androidTest/` suite — then deferred ACs become closable without override.
- Owed device smokes from v1.10.24 are listed in each slug's `00-index.md`
  `runtime-evidence-deferrals` (clear via `/wf probe` when a device is attached).
