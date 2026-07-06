---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: cross-cutting-url
status: defined
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: s
depends-on: []
tags: [behaviour-preserving, cross-cutting]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-detail-viewmodel.md, 03-slice-list-viewmodel.md, 03-slice-article-repository.md]
  plan: 04-plan-cross-cutting-url.md
  implement: 05-implement-cross-cutting-url.md
---

# Slice: Shared URL normalization (B9 / reuse-10)

## Goal
Replace the 6 duplicated URL-normalization sites with one `Article.computeNormalizedUrl()`
extension — behaviour-preserving.

## Why This Slice Exists
Cross-cutting dedup that spans several files. Small and mechanical, but it touches files other
slices also edit, so its conflict surface is called out explicitly. Kept as its own thin slice so
the single-source extraction is reviewable in isolation.

## Scope
- **In (reuse-10):** Add `Article.computeNormalizedUrl()` extension; replace the 6 inline
  normalization sites with calls to it. Identical output to today.
- **Out:** Any behavioural change to normalization — the extension must reproduce current results
  byte-for-byte across all 6 sites.

## Acceptance Criteria
- **B9** — Given the 6 prior URL-normalization sites When each computes a normalized URL Then it
  calls `Article.computeNormalizedUrl()` and produces the **same** result as before. `automated` + review

## Dependencies on Other Slices
- None hard, but **conflict-prone**: the 6 sites overlap files touched by `article-repository`,
  `list-viewmodel`, and `detail-viewmodel`. Land it when those are settled (or rebase carefully) to
  avoid churn. Plan confirms the exact 6 sites against current code.

## Risks
- The 6 sites may not be byte-identical today (subtle per-site differences) — if so, surface as a
  finding rather than silently unifying divergent behaviour.
