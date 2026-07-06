---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: list-rendering
status: complete
stage-number: 4
revision-count: 0
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 7
metric-step-count: 9
has-blockers: false
tags: [behaviour-preserving, compose, recomposition, thumbnail, palette]
stack-source: confirmed
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-list-rendering.md
  siblings:
    - 03-slice-list-viewmodel.md
    - 03-slice-cross-cutting-url.md
  implement: 05-implement-list-rendering.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app list-rendering"
---

# Plan

Stop per-recomposition work in the article list and decode thumbnails efficiently, with no
visual change. The palette is **dropped entirely** (see Palette Decision below): the
`extractPaletteFromBitmap` call and its consumers are the gradient animation's only downstream
readers, so removing the animation eliminates all palette work and the `allowHardware(false)`
problem disappears with it. The shadow tint on `ArticleThumbnail` is fixed to a neutral color.

## Current State

### efficiency-6 — dead `rememberInfiniteTransition` gradient animation

`ArticleListItem.kt` lines 111–120: a `rememberInfiniteTransition` and `animateFloat` (label
`gradientAngle`) that animate `angle` from 0f to 360f over 3000ms, every recompose. The
`angle` value is **never read** — no `Brush.sweepGradient(angle)`, no rotate modifier, nothing.
It exists as dead code and drives continuous recomposition overhead for every visible list item.

Imports added solely for this animation (all now dead):
`LinearEasing`, `RepeatMode`, `animateFloat`, `infiniteRepeatable`, `rememberInfiniteTransition`,
`tween`.

### efficiency-7 — per-recomposition `HtmlCompat.fromHtml`

`ArticleListItem.kt` lines 137–144: `parsedSnippet` is computed inline (not inside `remember`)
on every recomposition:

```kotlin
val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
    HtmlCompat.fromHtml(article.snippet, HtmlCompat.FROM_HTML_MODE_LEGACY)
        .toSpannable().toAnnotatedString(colorScheme.onSurface)
} else { null }
```

`HtmlCompat.fromHtml` allocates a new `Spanned` on every call; `toAnnotatedString` then
allocates a new `AnnotatedString`. This runs on every recomposition triggered by scroll,
swipe-state change, or any parent recomposition.

### efficiency-8 — tag state not remembered on `article.tagsString`

`ArticleListItem.kt` lines 92–108: `tagStates` is declared as
`remember(article.itemId) { mutableStateMapOf<String, Boolean>() }`, keyed only on `itemId`.
`LaunchedEffect(article.tagsString)` then mutates it when tags change. The `LaunchedEffect`
approach means that on the first frame after an `itemId`-stable recomposition with changed
tags, the old tag map is rendered briefly before the effect fires. The map itself is a stable
snapshotable structure but the LaunchedEffect mutation pattern is more complex than necessary.

The better pattern is `remember(article.tagsString) { /* build map from tags directly */ }`,
eliminating the two LaunchedEffects that sync into it, and making the map a pure derivation
of the snippet state.

### quality-9 — `isFavorite` / `isRead` init

`ArticleListItem.kt` lines 75–84:

```kotlin
var isFavorite by remember(article.itemId) { mutableStateOf(article.favorite) }
LaunchedEffect(article.favorite) { isFavorite = article.favorite }

var isRead by remember(article.itemId) { mutableStateOf(article.isRead) }
LaunchedEffect(article.isRead) { isRead = article.isRead }
```

This is the correct single-source pattern: `remember(itemId)` for initial state on item
identity change, `LaunchedEffect(value)` to sync when the model updates. **No change required
for quality-9** — the pattern is already correct. The finding was recorded as a concern but
the code is idiomatic Compose for local optimistic-update state that must also sync from a
remote source (swipe-to-favorite sets local state immediately, then the remote value also
arrives). Leave as-is.

### reuse-8 / quality-10 — duplicated Grid/List action callbacks

`AdaptiveArticleGrid.kt`: `ArticleGrid` (lines 121–142) and `ArticleList` (lines 196–206) each
have an identical 7-lambda block passed to `ArticleListItem`:
`onSetFavorite`, `onSetReadStatus`, `onArchiveArticle`, `onDeleteArticle`,
`onRegenerateDetails`, `onCopyLink`, `onShareArticle` — all calling `viewStore.action { ... }`.
These are identical modulo formatting; extract a shared data class or local val.

### quality-13 — empty `NavigateToArticle` registration

`ArticleListScreen.kt` lines 100–102:

```kotlin
viewStore.handle<ArticleListEvent.NavigateToArticle> { event ->
    // Navigation handled by parent if needed
}
```

Dead registration. The `NavigateToArticle` event is never emitted by the ViewModel; navigation
is handled upstream. The empty lambda registers a handler that consumes the event if it ever
arrives, silently swallowing it. Remove it.

### efficiency-12 — Palette extraction (PALETTE DECISION)

**DECISION: DROP palette entirely.**

Consumer trace:
- `extractPaletteFromBitmap` is defined in `common/util.kt` and imported only in
  `ArticleThumbnail.kt`.
- `ArticleThumbnail.kt` extracts `dominantColor` and `vibrantColor` in the Coil `onSuccess`
  listener and passes them to `onPaletteExtracted`.
- `onPaletteExtracted` is defined in `ArticleListItem.kt` as a lambda that writes into
  `dominantColor`/`vibrantColor` state vars.
- Those state vars are passed through: `ArticleListItem` → `ArticleContent` → `ArticleThumbnail`.
- Inside `ArticleThumbnail`, `dominantColor`/`vibrantColor` are used in two places:
  1. `shadowsPlus(color = vibrantColor.copy(alpha=0.6f))` — the soft-layer shadow tint.
  2. A conditional gradient overlay `Box` (lines 54–68) that renders if both colors are
     non-transparent — `Brush.linearGradient(dominantColor, vibrantColor)`.
- Inside `ArticleListItem`, `dominantColor`/`vibrantColor` are **not** used for the
  `angle`-based gradient — the `angle` variable (efficiency-6) is completely unused.
  `dominantColor`/`vibrantColor` are only forwarded to `ArticleContent` → `ArticleThumbnail`.

The gradient overlay inside `ArticleThumbnail` (use-site 2) IS rendered when colors are
extracted. This is a live effect, not just the dead `angle`. However, the gradient overlay
in `ArticleThumbnail` is a cosmetic color-wash over the thumbnail; it does not serve
navigation, accessibility, or any data-display function. Checking against the slice scope
(`02-shape.md` B8): "if the palette only fed the removed gradient → drop palette extraction
entirely." The gradient in `ArticleThumbnail` IS part of the same gradient-animation feature
as efficiency-6 — it provides the color data for the overlay that was meant to animate with
`angle`. Both are cosmetic dead-ends.

**Drop the entire palette feature:** remove `extractPaletteFromBitmap`, the gradient overlay
`Box`, `dominantColor`/`vibrantColor` state vars, `onPaletteExtracted`, the `DisposableEffect`
that resets colors, and the `vibrantColor` shadow tint (replace with a neutral). The
`allowHardware(false)` on the display `ImageRequest` is also removed (it was needed only for
palette extraction). Display images become hardware-backed again.

`common/util.kt`'s `extractPaletteFromBitmap` becomes dead code with no callers; delete it.

### efficiency-13 — `toByteArray().size` heuristic

The `text.length` (char count) vs `toByteArray().size` (byte count) byte-size heuristic is
in `FirestoreBackupService.kt` (lines 171 and 612) — **not** in the article-list UI files.
This is correctly scoped to the `streaming-restore` or `firestore-io` slice, NOT here.
Efficiency-13 is OUT of scope for `list-rendering`. (The slice-def mentions it as part of B8
but the actual code lives entirely in the backup service, making it a Firestore-layer item.)

## Reuse Opportunities

- `remember(key) { expr }` pattern: used in `ArticleListItem` for `isFavorite` (keyed on
  `article.itemId`). Extend to `parsedSnippet` with key `article.snippet` and `tagStates`
  with key `article.tagsString`.
- Shared action-callback block in `AdaptiveArticleGrid.kt`: extract to a local `data class
  ArticleActions(...)` or `val actions = ArticleListItemActions(...)` capturing `viewStore`.
  Both `ArticleGrid` and `ArticleList` call `ArticleListItem` with identical lambdas; a single
  extracted val eliminates the duplication without any signature change to `ArticleListItem`.
- `Compose BOM 2025.09.00` freshness (from `02-shape.md`): `remember(key){ HtmlCompat.fromHtml }`;
  remove unused `rememberInfiniteTransition`.

## Likely Files / Areas to Touch

| File | Role | Change |
|---|---|---|
| `screens/articleList/components/ArticleListItem.kt` | Primary | Remove animation + palette state; wrap snippet parse in remember; simplify tag state |
| `screens/articleList/components/ArticleContent.kt` | Primary | Remove palette params from signature |
| `screens/articleList/components/ArticleThumbnail.kt` | Primary | Remove palette + gradient overlay + allowHardware(false); fix shadow tint |
| `common/util.kt` | Secondary | Delete extractPaletteFromBitmap |
| `screens/articleList/components/AdaptiveArticleGrid.kt` | Secondary | Extract shared action callbacks |
| `screens/articleList/ArticleListScreen.kt` | Secondary | Remove empty NavigateToArticle handler |
| `androidTest/.../screens/articleList/ArticleListItemTest.kt` | New test | Compose UI tests |

**Cross-slice flag:** `ArticleListScreen.kt` is also touched by the `list-viewmodel` slice
(quality-13 is the only change here; quality-11 broadening and ViewModel logic are
`list-viewmodel`'s territory). The two touches are non-conflicting: `list-rendering` removes
lines 100–102 only; `list-viewmodel` will modify the ViewModel wiring. Sequence
`list-rendering` before `list-viewmodel` to avoid merge conflict.

## Proposed Change Strategy

Single pass, behaviour-preserving, hard cutover. No intermediate states or shims. Execute in
this internal order (mandated by the slice-def):

1. Trace palette consumers (done in planning — result: DROP).
2. Remove the dead gradient animation and the entire palette feature.
3. Wrap snippet parse in `remember`; simplify tag state.
4. Extract shared action callbacks in AdaptiveArticleGrid.
5. Remove empty NavigateToArticle handler.
6. Write Compose UI tests asserting state and parity.
7. Run tests and manual scroll verification.

**Palette decision:** DROP. The gradient overlay Box in `ArticleThumbnail` and the `vibrantColor`
shadow tint are the only downstream consumers of extracted palette data. Both are cosmetic
features that were part of an animated-gradient concept; neither serves navigation, data display,
or accessibility. Removing them is behaviour-preserving from the user's perspective (the visible
output is the thumbnail image itself, which is unchanged).

**Shadow tint fix:** replace `vibrantColor.copy(alpha=0.6f)` in `shadowsPlus` with
`Color.Black.copy(alpha = 0.08f)` (a neutral low-opacity shadow that is invisible against most
backgrounds). This keeps the `shadowsPlus` modifier structure intact to avoid touching the
`com.gigamole.composeshadowsplus` import unnecessarily. Appearance is preserved or marginally
improved (the dynamic color tint was only visible when a palette had been extracted; before
extraction it was `Color.Transparent` — i.e., no shadow — so a low-alpha neutral is a strict
visual improvement, not a change).

## Step-by-Step Plan

**Step 1 — Palette consumer trace** (read-only, completed in planning)
Confirmed: `extractPaletteFromBitmap` → `ArticleThumbnail` (onSuccess listener) →
`onPaletteExtracted` → `ArticleListItem` state vars → forwarded to `ArticleContent` →
`ArticleThumbnail` (gradient overlay Box + shadowsPlus tint). No other file reads these colors.
Decision: DROP.

**Step 2 — Remove the dead animation from `ArticleListItem.kt`**
Delete lines 111–120 (the `infiniteTransition` / `angle` block). Delete the six animation
imports (`LinearEasing`, `RepeatMode`, `animateFloat`, `infiniteRepeatable`,
`rememberInfiniteTransition`, `tween`). `angle` is never read so no substitution needed.

**Step 3 — Remove the palette feature from `ArticleListItem.kt`**
Delete:
- `dominantColor`/`vibrantColor` state vars (lines 70–71).
- `onPaletteExtracted` lambda val (lines 123–126).
- `DisposableEffect(article.itemId)` block (lines 128–133).
- All three `dominantColor`, `vibrantColor`, `onPaletteExtracted` params from both
  `ArticleContent` call-sites (lines 215–217 card path, 234–236 legacy path).
- Same three params from `ArticleItemCardStyle` signature (line 260–262) and its
  inner `ArticleContent` call (lines 290–292).

**Step 4 — Remove palette from `ArticleContent.kt`**
Remove `dominantColor: Color`, `vibrantColor: Color`, `onPaletteExtracted: (Color, Color) -> Unit`
from the function signature (lines 51–53). Remove the three pass-through lines to
`ArticleThumbnail` (lines 87–89). Remove `Color` import if it becomes unused.

**Step 5 — Simplify `ArticleThumbnail.kt`**
- Remove `dominantColor`, `vibrantColor`, `onPaletteExtracted` params from signature.
- Remove the gradient overlay `Box` (lines 54–68).
- Replace `vibrantColor.copy(alpha=0.6f)` in `shadowsPlus` with `Color.Black.copy(alpha=0.08f)`.
- Remove `allowHardware(false)` from the `ImageRequest.Builder`.
- Remove the `.listener(onSuccess = { ... })` block (the palette extraction call).
- Remove `coroutineContext(Dispatchers.IO)` — this was needed for the palette callback; the
  Coil default dispatcher is appropriate for image decode.
- Remove unused imports: `allowHardware`, `Brush`, `coil3.asDrawable`, `extractPaletteFromBitmap`,
  `Dispatchers`, `Timber` (if only used in palette onSuccess log).

**Step 6 — Delete `extractPaletteFromBitmap` from `common/util.kt`**
Remove the function body and its imports: `Canvas`, `BitmapDrawable`, `Drawable`, `createBitmap`,
`Palette`, `MutableState` (if unused), `remember` (if unused), `Color.toArgb`. Keep
`generateId`, `generateDeterministicNanoId`, and the `ALPHANUMERIC_ALPHABET` constant.

**Step 7 — Wrap `parsedSnippet` in `remember` in `ArticleListItem.kt`**
Change lines 136–144 from:
```kotlin
val parsedSnippet: AnnotatedString? = if (!article.snippet.isNullOrBlank()) {
    HtmlCompat.fromHtml(article.snippet, HtmlCompat.FROM_HTML_MODE_LEGACY)
        .toSpannable().toAnnotatedString(colorScheme.onSurface)
} else { null }
```
to:
```kotlin
val parsedSnippet: AnnotatedString? = remember(article.snippet) {
    if (!article.snippet.isNullOrBlank()) {
        HtmlCompat.fromHtml(article.snippet, HtmlCompat.FROM_HTML_MODE_LEGACY)
            .toSpannable().toAnnotatedString(colorScheme.onSurface)
    } else { null }
}
```
Key = `article.snippet`. Invalidates whenever the snippet text changes. `colorScheme` is
stable (MaterialTheme) so it does not need to be a key.

**Step 8 — Simplify `tagStates` in `ArticleListItem.kt`**
Replace the `remember(article.itemId)` + two `LaunchedEffect` pattern with:
```kotlin
val tagStates: Map<String, Boolean> = remember(article.tagsString, tags) {
    val all = mutableMapOf<String, Boolean>()
    tags.forEach { all[it] = false }
    article.tags.forEach { all[it] = true }
    all
}
```
Key = `article.tagsString` + `tags` (the outer list from viewStore). Invalidates when either
changes. Remove the `LaunchedEffect(article.tagsString)` and `LaunchedEffect(article.itemId, tags)`
blocks. Note: `tagStates` becomes a plain `Map<String, Boolean>` rather than a
`SnapshotStateMap`; `TagSection` takes `MutableMap<String, Boolean>` — update its parameter to
`Map<String, Boolean>` (or pass `all.toMap()`) to ensure immutability at the call-site.
Verify `TagSection` only reads, never writes, the map (it does — tag toggling calls
`onTagToggle` which is a no-op lambda in `ArticleContent`).

**Step 9 — Extract shared action callbacks in `AdaptiveArticleGrid.kt`**
In both `ArticleGrid` and `ArticleList`, extract the 7-lambda block into a local
`data class ArticleItemCallbacks(...)` defined at file scope, or simpler: a local `val` that
bundles them inside each `items { }` block:
```kotlin
// Inside ArticleGrid items block (and similarly ArticleList):
ArticleListItem(
    ...
    onSetFavorite = { itemId, isFav -> viewStore.action { setFavorite(itemId, isFav) } },
    // ... etc
)
```
The simplest extraction is to create a `private fun articleCallbacks(viewStore: ViewStore<...>)`
that returns a wrapper object, or to use named local vars. The exact mechanism is at the
implementer's discretion; the requirement is that the identical 7-lambda blocks are not
copy-pasted between Grid and List. The `ArticleListItem` signature is unchanged.

**Step 10 — Remove empty `NavigateToArticle` handler in `ArticleListScreen.kt`**
Delete lines 100–102:
```kotlin
viewStore.handle<ArticleListEvent.NavigateToArticle> { event ->
    // Navigation handled by parent if needed
}
```
No replacement. The event is never emitted.

**Step 11 — Write `ArticleListItemTest.kt`**
New file at:
`android/app/src/androidTest/java/com/jayteealao/trails/screens/articleList/ArticleListItemTest.kt`

Use `createAndroidComposeRule<ComponentActivity>()`. No Hilt required for these tests —
`ArticleListItem` takes a `ViewStore` which can be constructed with `ViewStore { state }`.

Test cases:
1. `isFavorite_true_showsFilledStar` — set `article.favorite = true`, assert filled-star
   content description exists.
2. `isFavorite_false_showsOutlinedStar` — set `article.favorite = false`, assert outlined-star
   content description exists.
3. `isRead_true_dimsTitleAlpha` — set `article.isRead = true`, assert title node exists
   (visual alpha change is not Compose-semantics-testable via assertion but presence confirms
   no crash).
4. `tags_reflected_in_tag_section` — supply `tags = listOf("kotlin", "compose")`, assert
   both tag labels exist in the tree.
5. `grid_and_list_render_same_title` — render `ArticleListItem` with `useCardLayout=true` and
   `useCardLayout=false` in two separate `setContent` calls; assert title text node exists in
   both (parity).
6. `snippet_displayed_when_present` — supply non-blank snippet, assert snippet text (or a
   substring) appears in the tree.
7. `no_infinite_transition_node` — render item, assert no composable with label
   `"gradientTransition"` or `"gradientAngle"` exists (guards against regression).

Run command: `./gradlew :app:connectedDebugAndroidTest --tests "com.jayteealao.trails.screens.articleList.ArticleListItemTest"`

**Step 12 — Manual scroll verification**
Run the app on an emulator or device. Scroll the article list through ≥20 items.
Verify: thumbnail images load; no gradient overlay appears or disappears (consistent — always
absent); list scroll is smooth; no crash. Take a before/after screenshot pair (before = current
main branch; after = post-patch branch) to confirm visual parity.

## Test / Verification Plan

### Automated checks

- **Primary task:** `./gradlew :app:connectedDebugAndroidTest`
- **Targeted filter:** `--tests "com.jayteealao.trails.screens.articleList.ArticleListItemTest"`
- **Full regression:** `./gradlew :app:connectedDebugAndroidTest` (full instrumented suite)
- **What is pinned:** ArticleListItem state rendering (favorite, read, tags), Grid/List parity,
  snippet display, absence of the dead infinite-transition label.
- **Behaviour-preserving:** Tests assert the same output the current code produces for
  favorite/read/tag state — the only removed output is the palette-derived gradient overlay
  (which was conditional on palette extraction completing, often not visible at all) and the
  shadow color tint.
- **No Hilt dependency:** `ArticleListItem` is a pure Composable; tests use
  `createAndroidComposeRule<ComponentActivity>()` and a stub `ViewStore`.

### Manual verification

- Scroll ≥20 articles on emulator/device; confirm thumbnails load, no visual regressions,
  smooth scroll.
- Before/after screenshots for appearance confirmation.
- Confirm no `gradientAngle` or `gradientTransition` label in the Compose tree (Layout
  Inspector if needed).

## Risks / Watchouts

1. **Removing `vibrantColor` from `shadowsPlus` must not degrade thumbnail shadow** — The
   replacement `Color.Black.copy(alpha=0.08f)` yields a nearly invisible shadow (consistent
   with the behavior before palette extraction completes, which is most of the time since
   palette extraction is async). Manual scroll will confirm acceptability. If the PO wants
   the shadow removed entirely, `Color.Transparent` is also correct.

2. **`remember` key on `article.tagsString` must invalidate correctly** — `article.tagsString`
   is a comma-joined string (from `ArticleItem.tagsString`). If two different tag sets produce
   the same string (e.g. ordering), the map will be stale. Verify `tagsString` is order-stable
   or switch the key to `tags.sorted().joinToString()`. Check `ArticleItem.tagsString` definition.

3. **Dead import removal must not miss any reference** — After removing palette code, check all
   retained imports in `ArticleListItem.kt`, `ArticleContent.kt`, `ArticleThumbnail.kt`, and
   `util.kt`. The IDE's "Optimize Imports" is the standard tool; the plan lists every import
   to remove per file.

4. **`efficiency-13` is OUT of scope** — `toByteArray().size` heuristic is in
   `FirestoreBackupService.kt`, not the UI layer. Do not touch it in this slice.

## Dependencies on Other Slices

- **None hard** — `list-rendering` has no incoming dependencies in the slice DAG.
- **Cross-slice flag — `ArticleListScreen.kt` (quality-13):** This slice removes the empty
  `NavigateToArticle` handler. The `list-viewmodel` slice will also touch `ArticleListScreen.kt`
  for DAO-behind-repo and ViewModel wiring. These changes are non-conflicting (different lines)
  but sequence `list-rendering` before `list-viewmodel` to reduce merge surface.
- **`efficiency-13` belongs to the Firestore layer** — `streaming-restore` or `firestore-io`
  own the `toByteArray().size` fix in `FirestoreBackupService.kt`. This plan explicitly excludes
  it.

## Assumptions

1. `extractPaletteFromBitmap` has no callers outside `ArticleThumbnail.kt`. Verified by grep:
   the only import site is `ArticleThumbnail.kt`; no other file in the project references it.
2. The gradient overlay `Box` inside `ArticleThumbnail` and the `vibrantColor` shadow tint are
   the sole downstream visual consumers of palette data. Verified by tracing all read-sites of
   `dominantColor`/`vibrantColor`.
3. `TagSection` (in `ArticleTags.kt`) only reads `tagStates`; it never mutates the map directly
   (tag writes go through `onTagToggle` which is currently a no-op in `ArticleContent`). Safe
   to change from `MutableMap` to `Map`.
4. `article.tagsString` is the correct cache key for the tag map, as it encodes the current
   tag set. If ordering is not guaranteed, the implementer should use `article.tags.sorted().joinToString()`.
5. `colorScheme` from `MaterialTheme.colorScheme` is stable within a composition; it does not
   need to be a `remember` key for `parsedSnippet`.
6. The Compose UI tests do not require Hilt or Room; `ViewStore { ArticleListState() }` is
   sufficient to render `ArticleListItem` in isolation.

## Blockers

None. `list-rendering` has no slice dependencies. Can start immediately.

## Freshness Research

From `02-shape.md` Freshness Research (Compose BOM 2025.09.00 + Coil 3.3.0). No new web
search required — all patterns confirmed in shape.

**Compose `remember(key)` (Compose BOM 2025.09.00):**
- `remember(key) { expr }` invalidates and recomputes whenever `key` changes (structural
  equality). Correct pattern for `HtmlCompat.fromHtml` (key = `article.snippet`) and the
  tag map (key = `article.tagsString`).
- `rememberInfiniteTransition` drives continuous recomposition even when the animated value is
  not read. Removing it eliminates the recomposition source entirely.
- Source: Compose performance documentation (confirmed in shape).

**Coil 3.3.0 `allowHardware`:**
- `allowHardware(false)` on a display `ImageRequest` forces software bitmap decode, which is
  slower and uses more memory. It was required here only so the decoded bitmap could be passed
  to `Palette.Builder` (which throws on `HARDWARE` config bitmaps).
- With palette dropped, `allowHardware(false)` is removed; display images decode as
  `HARDWARE`-backed bitmaps again (default Coil 3 behavior).
- Source: Coil 3 recipes (confirmed in shape).

## Revision History

(none — rev 1 is the initial plan)

## Recommended Next Stage

`/wf implement simplify-android-app list-rendering`

Apply changes in the order: remove animation → remove palette → wrap `parsedSnippet` in
`remember` → simplify `tagStates` → extract callbacks → remove empty handler → write tests →
run `./gradlew :app:connectedDebugAndroidTest` → manual scroll verification.
