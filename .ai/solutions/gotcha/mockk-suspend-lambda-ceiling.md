---
schema: sdlc/v1
type: solution
category: gotcha
source-workflow: simplify-android-app
created-at: "2026-07-11T08:44:42Z"
tags: [mockk, suspend, lambda, callback, kotlin, coroutines, integration-test, android]
status: active
---

# MockK can't invoke suspend lambdas from stub answers — plan tests around it

## Problem
MockK 1.14.5 cannot invoke a `suspend` lambda parameter from inside a stub `answers`
body (no coroutine context there). Any API shaped like
`suspend fun restore(onPage: suspend (List<T>) -> Unit)` cannot have its callback
driven from a mock. This weakened integration tests in TWO consecutive slices
(streaming-restore, then batched-tag-reads) — the second plan wasn't updated after the
first slice documented the wall, and both fell back to call-count / zero-invocation
assertions instead of data-flow proofs. A bulk tag DAO query bug slipped through to
review (fix commit "bulk tag DAO query…") that a data-flow test would have caught.

## Learning
When a suspend-callback API needs integration testing, don't mock the producer — use a
hand-rolled fake (a real class implementing the interface, driving the callback from a
`runTest` scope). Mocks are for verifying calls INTO a dependency; fakes are for
driving data OUT of one. And when a slice documents a tooling ceiling in its
deviations, update the still-unexecuted plans of sibling slices before running them.

## How to apply
- Grep the plan's test design for `suspend (` in mocked interfaces; swap those mocks
  for fakes at plan time.
- Existing precedent: the app's test suite already has repo-level fakes/stubs
  (list-viewmodel slice migrated tests to repo stubs) — extend that pattern.
