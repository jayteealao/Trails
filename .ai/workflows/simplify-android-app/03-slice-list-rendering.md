---
schema: sdlc/v1
type: slice
slug: simplify-android-app
slice-slug: list-rendering
status: complete
stage-number: 3
revision-count: 1
created-at: "2026-06-14T22:28:57Z"
updated-at: "2026-06-14T22:28:57Z"
complexity: m
depends-on: []
tags: [behaviour-preserving, compose, recomposition, thumbnail]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  siblings: [03-slice-list-viewmodel.md, 03-slice-cross-cutting-url.md]
  plan: 04-plan-list-rendering.md
  implement: 05-implement-list-rendering.md
---

# Slice: Article-list rendering — recomposition + thumbnail (B6 + B8)

## Goal
Stop the article list doing per-recomposition work and decode thumbnails efficiently, with **no
visual change**. B6 and B8 are merged into one slice because removing the dead gradient animation
(B6) may delete the **only** consumer of B8's extracted palette — so the palette/`allowHardware`
decision must be made in the same place, after tracing consumers.

## Why This Slice Exists
The PO chose to resolve the B6↔B8 coupling **internally in one slice** rather than as a cross-slice
dependency on a moving target: trace palette consumers, remove the dead animation, then decide the
palette fate together. Appearance must not change; verified by Compose UI tests + manual scroll.

## Scope
- **In (B6):**
  - **efficiency-6:** remove the dead `rememberInfiniteTransition` gradient animation.
  - **efficiency-7:** `remember(article.snippet) { HtmlCompat.fromHtml(...) }` — no per-recomposition parse.
  - **efficiency-8:** `remember(tags)` the tag state.
  - **quality-9:** single-source `isFavorite`/`isRead` init.
  - **reuse-8 / quality-10:** extract shared Grid/List action callbacks.
  - **quality-13:** remove the empty `NavigateToArticle` registration (confirmed dead).
- **In (B8):**
  - **efficiency-12:** **first trace palette consumers.** If the palette only fed the now-removed
    gradient → drop palette extraction entirely (and the `allowHardware` problem disappears). Else
    scope `allowHardware(false)` to a **per-request** palette load so display images stay
    hardware-backed (Coil 3: HARDWARE bitmaps throw in `Palette`).
  - **efficiency-13:** `toByteArray().size` instead of the `text.length` byte heuristic.
- **Out:** ListViewModel logic (→ `list-viewmodel`); URL normalization (→ `cross-cutting-url`).

## Acceptance Criteria
- **B6** — Given the article list scrolling When items recompose Then there is **no** per-recomposition
  `HtmlCompat.fromHtml`, **no** dead infinite animation, single-sourced `isFavorite`/`isRead`, shared
  Grid/List action callbacks, and no empty `NavigateToArticle` handler — **appearance unchanged**.
  Verified by Compose UI tests + manual scroll. `automated` + `manual`
- **B8** — Given thumbnail decode When an image loads Then palette consumers have been traced and
  either palette is dropped (no downstream reader) or `allowHardware(false)` is scoped to a dedicated
  per-request palette load (display images stay hardware-backed); byte sizing uses
  `toByteArray().size`. `automated` + review

## Dependencies on Other Slices
- None hard. Internally ordered: trace palette consumers → remove gradient → decide palette.

## Risks
- Removing the infinite animation must not leave a referenced-but-undefined value (shape risk).
- `remember` keys must invalidate correctly when `article.snippet`/`tags` change.
- If palette kept: HARDWARE bitmaps must never reach `Palette.Builder` (throws). If dropped: ensure
  nothing downstream reads the removed colors.
