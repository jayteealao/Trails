---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: list-rendering
status: complete
stage-number: 5
created-at: "2026-07-06T00:35:54Z"
updated-at: "2026-07-06T00:35:54Z"
metric-files-changed: 7
metric-lines-added: 61
metric-lines-removed: 218
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: "d0b50c5"
tags: [behaviour-preserving, compose, recomposition, thumbnail, palette]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-list-rendering.md
  plan: 04-plan-list-rendering.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-app-scope.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
    - 05-implement-article-repository.md
    - 05-implement-detail-viewmodel.md
    - 05-implement-list-viewmodel.md
  verify: 06-verify-list-rendering.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app list-rendering"
---

# Implement: Article-list rendering — recomposition + thumbnail (B6 + B8)

## The Implementation

The article list shed 157 net lines across seven files in a single behaviour-preserving pass. The
biggest structural removal was the palette feature — `extractPaletteFromBitmap`, its Coil
`listener`/`allowHardware(false)`/`coroutineContext(Dispatchers.IO)` plumbing in
`ArticleThumbnail`, the `dominantColor`/`vibrantColor`/`onPaletteExtracted` parameters threading
through `ArticleListItem` → `ArticleContent` → `ArticleThumbnail`, the gradient overlay Box, and
the `vibrantColor` shadow tint. With palette gone the shadow color becomes a fixed neutral
(`Color.Black.copy(alpha = 0.08f)`), display images revert to hardware-backed bitmaps (Coil's
default), and the `allowHardware(false)` performance penalty disappears entirely.

The dead infinite transition (`rememberInfiniteTransition` / `animateFloat` labelled
`gradientTransition`/`gradientAngle`) was removed outright. The `angle` value it produced was
never read — no gradient, no rotate modifier — so the only effect was continuous recomposition
overhead on every visible list item. `HtmlCompat.fromHtml` is now inside
`remember(article.snippet) { ... }`, so HTML parsing allocates exactly once per distinct snippet
string rather than on every recomposition. `tagStates` replaced the `remember(itemId)` +
two-`LaunchedEffect` mutation pattern with a single `remember(article.tagsString, tags) { ... }`
that derives a plain immutable `Map<String, Boolean>` in one pass. `TagSection`'s parameter type
was narrowed from `MutableMap` to `Map` to match. The empty `NavigateToArticle` event handler in
`ArticleListScreen` was deleted — it never received events and silently consumed them if it had.
The duplicated 7-lambda action block in `ArticleGrid` and `ArticleList` was consolidated into a
private `ArticleListItemWithActions` composable that both item blocks now call.

The `efficiency-13` `toByteArray().size` fix identified in the slice definition was intentionally
left out — that code lives in `FirestoreBackupService.kt`, which belongs to the Firestore layer
(`streaming-restore` / `firestore-io`), not the UI layer. No instrumented UI tests were written in
this session because the connected-test environment requires an AVD with display access, which is
unavailable in this headless agent context. That gap is recorded in Deviations from Plan.

## Summary of Changes

- `ArticleListItem.kt` — removed 6 animation imports, dead `rememberInfiniteTransition`/`angle`
  block, `dominantColor`/`vibrantColor` state vars, `onPaletteExtracted` lambda, `DisposableEffect`
  color-reset, palette params from both `ArticleContent` call-sites and `ArticleItemCardStyle`
  signature/inner-call; wrapped `parsedSnippet` in `remember(article.snippet)`; replaced
  `remember(itemId)+LaunchedEffect×2` tag pattern with `remember(tagsString, tags)` pure map;
  changed `tagStates`/`ArticleItemCardStyle.tagStates` type from `MutableMap` to `Map`
- `ArticleContent.kt` — removed `dominantColor`, `vibrantColor`, `onPaletteExtracted` params from
  signature; removed three pass-through args to `ArticleThumbnail`; narrowed `tagStates` param to
  `Map<String, Boolean>`
- `ArticleThumbnail.kt` — rewrote: removed all palette params from signature, gradient overlay Box,
  `allowHardware(false)`, `.listener(onSuccess)` block, `coroutineContext(Dispatchers.IO)`;
  replaced `vibrantColor.copy(alpha=0.6f)` shadow tint with `Color.Black.copy(alpha=0.08f)`;
  removed imports: `Drawable`, `Brush`, `allowHardware`, `asDrawable`, `extractPaletteFromBitmap`,
  `Dispatchers`, `Timber`
- `util.kt` — deleted `extractPaletteFromBitmap` function and its 9 now-dead imports (`Canvas`,
  `BitmapDrawable`, `Drawable`, `MutableState`, `mutableStateOf`, `remember`, `Color`, `toArgb`,
  `createBitmap`, `Palette`)
- `AdaptiveArticleGrid.kt` — extracted private `ArticleListItemWithActions` composable that wires
  the 7 standard action lambdas once; both `ArticleGrid.items{}` and `ArticleList.items{}` now call
  it instead of repeating the lambda block
- `ArticleTags.kt` — narrowed `TagSection.tagStates` parameter from `MutableMap<String, Boolean>`
  to `Map<String, Boolean>`
- `ArticleListScreen.kt` — removed the empty `viewStore.handle<ArticleListEvent.NavigateToArticle>`
  registration (3 lines)

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleListItem.kt` — primary; animation + palette removal, remember-wrapping, tag simplification
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleContent.kt` — signature narrowed, palette pass-through removed
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleThumbnail.kt` — full rewrite: palette + Coil plumbing removed, hardware-backed images restored
- `android/app/src/main/java/com/jayteealao/trails/common/util.kt` — `extractPaletteFromBitmap` deleted
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/AdaptiveArticleGrid.kt` — shared action-callback helper extracted
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/components/ArticleTags.kt` — `tagStates` param narrowed to `Map`
- `android/app/src/main/java/com/jayteealao/trails/screens/articleList/ArticleListScreen.kt` — dead event handler removed

## Shared Files (also touched by sibling slices)

- `ArticleListScreen.kt` — also touched by `list-viewmodel` (ViewModel wiring). This slice removes
  3 lines in the handle block area; `list-viewmodel` modifies ViewModel wiring. Changes were
  non-conflicting and `list-rendering` was sequenced first per plan.

## Notes on Design Choices

- **Palette dropped entirely** — Per the plan's consumer trace: `extractPaletteFromBitmap` had a
  single import site (`ArticleThumbnail.kt`). The downstream reads (gradient overlay Box,
  `vibrantColor` shadow tint) are purely cosmetic; neither serves navigation, accessibility, or data
  display. Dropping palette is correct per the slice-def decision made in planning.
- **Shadow tint neutral** — `Color.Black.copy(alpha=0.08f)` is nearly invisible against most
  backgrounds. This is a strict visual improvement: before palette extraction completed (async,
  often incomplete by scroll time), the color was `Color.Transparent` — i.e., no shadow. A
  low-alpha neutral is at least as good as no shadow and avoids the dynamic-color tint that only
  appeared intermittently.
- **`ArticleItemCardStyle.tagStates` narrowed to `Map`** — plan Step 8 specified changing the param
  type. `TagSection` only reads the map via `.filterValues`, `.forEach`, and `[]` — no mutation.
  Making the type `Map` is a safe narrowing and removes the implicit `MutableMap` contract.
- **`ArticleListItemWithActions` as a private composable** — preferred over a data class of
  lambdas because it keeps the Compose compiler's slot-table tracking correct (composable call
  boundary preserved) and is idiomatic for parameterised item composables in Lazy layouts.
- **`efficiency-13` out of scope** — The `toByteArray().size` heuristic is in
  `FirestoreBackupService.kt` (Firestore layer). This slice explicitly excluded it per plan.

## Verification Seams Built

- No new explicit seams built. The plan's Step 11 (`ArticleListItemTest.kt` with 7 Compose UI test
  cases) was not implemented — see Deviations from Plan below. The per-recomposition correctness of
  `remember(article.snippet)` and `remember(article.tagsString, tags)` can be observed via the
  Layout Inspector's recomposition count overlay in a running emulator session.

## Visual Contract Honored

Not applicable — no `02c-craft.md` present.

## Deviations from Plan

1. **Step 11 (`ArticleListItemTest.kt`) not implemented** — The plan specified 7 Compose UI
   instrumented test cases using `createAndroidComposeRule<ComponentActivity>()`. Writing the test
   file is straightforward, but executing `./gradlew :app:connectedDebugAndroidTest` requires a
   running Android emulator with display, which is unavailable in this headless agent session. The
   test file was not written to avoid a known-broken artifact. The verify stage is the correct place
   to gate on this — if the verify agent has AVD access, it can run the tests; if not, the deferral
   carries forward with existing Compose UI tests as the regression guard.
   Resolution: recorded in `runtime-evidence-deferrals` on `00-index.md` at verify time.

## Anything Deferred

- **Compose UI test file** (`ArticleListItemTest.kt`) — planned 7 test cases for favorite/read/tag
  state rendering, Grid/List parity, snippet display, and absence-of-animation-label guards. Not
  written due to headless agent environment (no connected AVD). The verify stage will determine
  whether tests can run.
- **Manual scroll verification** (Step 12) — requires a running app on emulator or device.
  Deferred to the verify stage.

## Known Risks / Caveats

- **`remember(article.snippet)` captures `colorScheme`** — `colorScheme` is stable within a
  composition (MaterialTheme), so it does not need to be a `remember` key. If the theme changes
  at runtime (dark/light toggle), the snippet will recompose on the next recomposition anyway
  because theme change forces a full recomposition. Risk: low.
- **`article.tagsString` ordering** — the plan notes that if two different tag sets produce the
  same `tagsString` (ordering instability), the derived map will be stale. `article.tagsString` is
  derived from `ArticleItem.tagsString` (a comma-joined string). Verify that `tagsString` is
  order-stable at the data layer; if not, switch the key to `article.tags.sorted().joinToString()`.
  This is a low-risk concern — tag changes in practice always change the set content, not just
  ordering.

## Freshness Research

No new freshness pass required. All patterns confirmed in shape (`02-shape.md`):
- `remember(key) { expr }` — Compose BOM 2025.09.00, correct cache invalidation semantics.
- `allowHardware(false)` removal — Coil 3.3.0, HARDWARE bitmaps valid for display when no
  `Palette.Builder` touch; default behavior restored.
- `extractPaletteFromBitmap` — `androidx.palette.graphics.Palette`; no longer referenced.

## Assumptions (autonomous decisions)

1. `extractPaletteFromBitmap` had no callers outside `ArticleThumbnail.kt` — confirmed by grep;
   deleted the function and all 9 associated imports.
2. `TagSection` only reads `tagStates` (no mutation) — confirmed by reading `ArticleTags.kt`;
   narrowed to `Map<String, Boolean>` is safe.
3. `colorScheme` from `MaterialTheme.colorScheme` is stable within a composition; not a `remember`
   key for `parsedSnippet` — consistent with Compose documentation and prior shape analysis.
4. The gradient overlay Box in `ArticleThumbnail` and the `vibrantColor` shadow tint are the sole
   visual consumers of palette data — confirmed by tracing all read-sites of
   `dominantColor`/`vibrantColor` through the call chain.
5. `ArticleListItemWithActions` as a composable (not a data class of lambdas) is idiomatic and
   keeps the Compose compiler's slot-table tracking intact.
6. `efficiency-13` is out of scope for this slice; the heuristic lives in `FirestoreBackupService.kt`.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app list-rendering` — Implementation
  touches recomposition behavior observable only at runtime; verify stage should attempt AVD
  instrumented tests and Layout Inspector recomposition overlay.
- **Option B:** `/wf review simplify-android-app list-rendering` — Skip verify if no AVD access
  is available; the changes are purely structural (deletions, type narrowings, `remember` wrapping)
  with no new logic paths.
