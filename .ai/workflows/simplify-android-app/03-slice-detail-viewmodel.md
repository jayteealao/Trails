---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: detail-viewmodel
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: []
tags: [behaviour-preserving, viewmodel]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-list-viewmodel.md, 03-slice-cross-cutting-url.md]
  plan: 04-plan-detail-viewmodel.md
  implement: 05-implement-detail-viewmodel.md
---

# Slice: ArticleDetailViewModel cleanup (B4)

## Goal
Simplify `ArticleDetailViewModel` without changing behaviour: replace the manual combine with
nested `combine()` to drop the 9 unchecked casts, and remove stringly-typed / leaky bits.

## Why This Slice Exists
Self-contained ViewModel-area cleanup (by-code-area axis). Independent of the Firestore and
repository slices, so it can be planned/implemented in parallel with them.

## Scope
- **In:**
  - **quality-4:** nested `combine()` to drop 9 unchecked casts.
  - **quality-6:** typed `SettingsPreferenceKeys.USE_FREEDIUM` instead of a stringly-typed key.
  - **reuse-5:** `@Singleton UrlModifier` (single instance instead of re-created).
  - **reuse-11:** `ArchiveType` enum instead of magic strings/ints.
- **Out:** Anything outside `ArticleDetailViewModel` and the small DI/enum/key it introduces.
  The cross-cutting URL normalization extension is `cross-cutting-url` (B9).

## Acceptance Criteria
- **B4** — Given `ArticleDetailViewModel` When state is assembled Then it uses nested `combine()`
  with no unchecked casts, a typed settings key, a `@Singleton UrlModifier`, and an `ArchiveType`
  enum — with no change to observable behaviour. `automated` + review

## Dependencies on Other Slices
- None hard. `reuse-5` (`@Singleton UrlModifier`) and `reuse-11` (`ArchiveType`) may have consumers
  elsewhere — plan verifies call sites before changing scope/representation.

## Risks
- Nested `combine()` must preserve the exact emission/state semantics (the Tartlet Store
  `combine()`→`stateIn()` pattern stays — refactor conforms to it, does not replace it).
- Promoting `UrlModifier` to `@Singleton` must be safe if it holds no per-instance mutable state.
