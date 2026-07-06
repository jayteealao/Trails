---
schema: sdlc/v1
type: plan-index
slug: simplify-android-app
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
planning-mode: all
slices-planned: 14
slices-total: 14
implementation-order: [test-net, fts-search-fix, streaming-restore, batched-tag-reads, app-scope, firestore-dedup, firestore-io, article-repository, detail-viewmodel, list-viewmodel, list-rendering, sync-worker, cross-cutting-url, architecture-docs]
conflicts-found: 0
deploy-gated: false
total-files-to-touch: 57
total-step-count: 117
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  slice-index: 03-slice.md
  shape: 02-shape.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app test-net"
---

# Plan Index — simplify-android-app

All 14 slices planned in parallel (dependency-tiered: planners within a tier ran
concurrently; downstream tiers read their upstream's freshly-written plan). Every plan
is execution-ready, **no blockers**, and **no shared-project deploy is required** — the
one potentially deploy-gated slice (`batched-tag-reads`) elected the client-only path, so
`firebase/` and the `trails-e428e` project are untouched and the work is **android/-only**.

The three plan-stage open questions from `00-index.md` are now **resolved by code
inspection** (see Cross-Cutting Concerns).

## Slice Plan Summaries

### `test-net` (m · 4 files · 10 steps) — gate, behaviour-preserving / test-only
Revive `DefaultArticleRepositoryTest` (MockK ctor injection) and `TestDatabaseModule`
(in-memory Room + MockK); extend `FirestoreBackupServiceTest` and add a new
`FirestoreSyncManagerTest` that pins **current** behaviour (N+1 tag loop, in-memory page
accumulation, auth-guards, adaptive chunk size, apply-remote, user-meta read) as the
baseline the dedup slices must preserve. **Key risk:** pin behaviour as-is, including quirks.

### `fts-search-fix` (s · 2 files · 5 steps) — A1, behaviour-changing
One-line fix: route `sanitizedQuery` (already computed) into
`articleDao.searchArticlesWithMatchInfo(...)` in `searchWithScore`; new `FtsSearchTest`
(MockK, no Room) pins intended sanitized+wildcard semantics across 7 edge cases.
**Key risk:** result-set change is intentional — pin post-fix, not pre-fix, behaviour.

### `streaming-restore` (l · 3 files · 11 steps) — A2/A2b, behaviour-changing
Redesign `restoreAllArticlesPaginated` to a **`suspend onPage` callback** (no list
accumulation → constant memory); extract `rehydrateLargeText` for A2b parity; delete
deprecated `restoreAllArticles()`; update both `FirestoreSyncManager` call sites.
**Decision (efficiency-5): callback over Flow** — both call sites already `fold→chunked`,
so the lambda collapses cleanly with identical cancellation/backpressure and no Flow plumbing.

### `batched-tag-reads` (m · 4 files · 8 steps) — A3, behaviour-changing, **NOT deploy-gated**
Replace N sequential `restoreArticleTags()` with `batchRestoreArticleTags(ids)` that fans
out ≤10 parallel `async` subcollection reads per page-chunk, feeding `applyRemoteArticles`.
**Decision (efficiency-4): client-only chunked parallel reads, collectionGroup rejected** —
`ArticleTags` has no `userId` field (can't filter to the auth'd user without a schema
migration) and no `firestore.indexes.json` exists. No index, no rules change, no deploy.

### `app-scope` (s · 5 files · 8 steps) — A4, behaviour-changing / reliability, **foundational**
New `@ApplicationScope` qualifier + `AppScopeModule` providing
`@Singleton CoroutineScope(SupervisorJob()+ioDispatcher)`; inject into
`ArticleRepositoryImpl` (removing the dead `ioDispatcher` param) and `FirestoreSyncManager`.
**Key risk (high):** `FirestoreSyncManager.cleanup()` currently calls `scope.cancel()` —
must be neutered (the singleton scope lives for app lifetime).

### `firestore-dedup` (l · 4 files · 11 steps) — B1, behaviour-preserving
Five discrete extractions, each followed by a characterization-suite run: collection
constants → companion; `withAuthenticatedUser{}` guard (**BackupService only**);
`addArticleToBatch(...)`; `applyRemoteArticles(...)`; tag-backup via `backupArticle`.
**Intentionally NOT merged:** `FirestoreSyncManager`'s auth guard sets
`SyncStatus.Error(...)` (≠ `Result.failure()`) — merging would change its error semantics.

### `firestore-io` (m · 5 files · 9 steps) — B2, behaviour-preserving
On B1's helpers: cache the user-meta read once/sync; per-chunk `WriteBatch` commit (tags
folded into `addArticleToBatch` via a backward-compatible `tags` param); bulk tag-delete
(`DELETE … WHERE itemId`). **efficiency-13 found already-correct** (both backup paths
already use `text.toByteArray().size`) — no fix needed, resolved-as-found.

### `article-repository` (s · 3 files · 7 steps) — B3, behaviour-preserving
Extend the post-app-scope ctor with the already-provided `FirebaseFirestore`/`FirebaseAuth`
singletons (drop `getInstance()` in `delete()`); batch `add()`'s per-item loop into the
existing `upsertArticles(List)`. **Key risk:** preserve upsert-by-URL semantics.

### `detail-viewmodel` (m · 5 files · 10 steps) — B4, behaviour-preserving
Two nested typed `combine()` groups drop all 9 unchecked casts (Tartlet
`combine()`→`stateIn()` preserved); `@Singleton UrlModifier` (sole consumer); typed
`SettingsPreferenceKeys.USE_FREEDIUM`; `ArchiveType` enum refs. **Note:** `ArchiveType`
already exists — reuse-11 is a string→enum-ref swap, not a new enum.

### `list-viewmodel` (s · 4 files · 8 steps) — B5, behaviour-preserving
Delete dead `_articles` + commented `sync()`; move 6 direct-DAO sites (across
`insertArticle`/`saveUrl`/`regenerateArticleDetails`) behind 3 new thin repo
pass-throughs; swap `GetArticleWithTextUseCase` for `articleRepository.pockets()` (already
exists) and delete the use case. **Sequence after B3; before `cross-cutting-url`.**

### `list-rendering` (m · 7 files · 9 steps) — B6+B8, behaviour-preserving, no visual change
Remove dead gradient animation; `remember(article.snippet){HtmlCompat.fromHtml}`; pure
`tagStates` derivation; single-source `isFavorite`/`isRead`; extract shared Grid/List
callbacks; remove empty `NavigateToArticle`. **Decision (efficiency-12): drop palette
entirely** — its only consumers (gradient overlay + shadow tint) die with the gradient;
`extractPaletteFromBitmap` and `allowHardware(false)` removed. Verified by Compose UI
tests + manual scroll.

### `sync-worker` (m · 3 files · 8 steps) — B7, behaviour-preserving
`syncJob.join()` (wrapped in `withTimeout`) replaces the `delay(5000)` poll; paginated
`getNonMetricsArticles(limit, offset)`; **delete** dead `syncArchivesInBackground` +
`populateTextFromArchive` + their raw `getInstance()` (commented-out at the only call
site; `ArchiveService` already injected for any future re-enable).

### `cross-cutting-url` (s · 4 files · 6 steps) — B9, behaviour-preserving, conflict-prone
Add `Article.computeNormalizedUrl()` to `UrlNormalizer.kt`; replace the **4** Article-typed
`article.url ?: article.givenUrl ?: ""` idiom sites (the 5 string-typed `normalizeUrl(...)`
sites are intentionally left). **Finding:** 9 normalization sites total, all byte-identical
(no divergence). **Land last** of its overlap set (ArticleRepository, ArticleListViewModel,
FirestoreSyncManager).

### `architecture-docs` (m · 4 files · 7 steps) — DoD #6, docs, **land last**
`docs/architecture/` (new): explanation `firestore-sync-backup.md`, explanation
`app-scope-di.md`, reference `batched-tag-reads.md` (**client-only query-shape note** —
collectionGroup rejected), plus a one-line README update (FTS + restore-memory fixes).
Includes an explicit External-Output-Boundary leak-check step.

## Cross-Cutting Concerns
- **Three open questions resolved by inspection:** efficiency-4 → client-only chunked
  parallel reads (no deploy); efficiency-5 → `suspend onPage` callback; efficiency-12 →
  drop palette entirely.
- **No deploy gate anywhere.** `firebase/` and `trails-e428e` are untouched; the workflow
  is fully android/-only. Handoff has no live-deploy precondition.
- **Behaviour-preserving by default.** Only `fts-search-fix`, `streaming-restore` (+A2b),
  `batched-tag-reads`, `app-scope` change behaviour — each pinned by its own tests; all
  others held to parity by the `test-net` characterization suite + existing tests.
- **Hard cutover** for every internal-signature change; all in-app callers updated within
  the owning slice (each plan enumerates them).
- **efficiency-13 is a no-op** (already-correct in code) — counts as resolved-as-found
  toward DoD #1; documented in `firestore-io`'s revision history.

## Integration Points Between Slices
- **`ArticleRepository.kt`** — member-disjoint edits across `app-scope` (ctor: +scope,
  −ioDispatcher), `fts-search-fix` (`searchWithScore`), `article-repository` (ctor:
  +Firebase, `add()`/`delete()`), `list-viewmodel` (+3 pass-throughs), `cross-cutting-url`
  (4 url idiom sites). Constructor edits concentrated in `app-scope` then `article-repository`.
- **`FirestoreSyncManager.kt` / `FirestoreBackupService.kt`** — `app-scope` (scope/cleanup),
  `streaming-restore` (restore methods + remove deprecated), `batched-tag-reads`
  (tag-read loop + `handleRemoteArticleChange` prefetch param), `firestore-dedup` (extract
  helpers), `firestore-io` (efficiency on those helpers). All distinct surfaces; the
  recommended order makes each a clean hard cutover.
- **Characterization tests** (`FirestoreSyncManagerTest`, `FirestoreBackupServiceTest`) are
  written by `test-net` and **updated** by `streaming-restore`, `firestore-dedup`,
  `firestore-io`, `batched-tag-reads` as each changes the pinned surface — expected, not a
  conflict. `firestore-io` notes B1's tag-delegation assertion needs a second update when B2
  moves tags into the chunk batch.
- **`ArticleListViewModel.kt`** — `list-viewmodel` (B5) then `cross-cutting-url` (B9, edits
  `insertArticle`/`saveUrl`). Sequence B5 → B9.
- **`ArticleListScreen.kt`** — `list-rendering` (quality-13) micro-overlaps `list-viewmodel`;
  different members, order between the two is flexible.

## Recommended Implementation Order
Dependent order with parallelizable points called out ("parallel where appropriate"):

1. **`test-net`** — the gate; everything depends on a green net. *(Tier 0)*
2. **`fts-search-fix`** — A1, isolated `searchWithScore` fix. *(after test-net; independent of the Firestore cluster — parallelizable with 3–5)*
3. **`streaming-restore`** — A2/A2b; sets the restore signature the Firestore cluster builds on.
4. **`batched-tag-reads`** — A3; rebases on the streaming loop shape (so after 3).
5. **`app-scope`** — A4; foundational scope for 6 + 8. *(2–5 touch member-disjoint surfaces; 2 is fully independent)*
6. **`firestore-dedup`** — B1; needs app-scope; assumes 3 & 4 landed.
7. **`firestore-io`** — B2; builds on B1's helpers.
8. **`article-repository`** — B3; needs app-scope; after fts-search-fix.
9. **`detail-viewmodel`** — B4; independent. *(parallelizable any time after test-net)*
10. **`list-viewmodel`** — B5; needs B3's stable repo surface.
11. **`list-rendering`** — B6+B8; independent. *(parallelizable any time after test-net)*
12. **`sync-worker`** — B7; independent. *(parallelizable any time after test-net)*
13. **`cross-cutting-url`** — B9; conflict-prone, land after its overlap set (8, 10, 6, 7, 9).
14. **`architecture-docs`** — DoD #6; needs the 5 structural slices settled — land last.

**Parallelizable groups** (once `test-net` is green): `{fts-search-fix}`,
`{detail-viewmodel, list-rendering, sync-worker}` can proceed independently of the Firestore
chain `streaming-restore → batched-tag-reads → app-scope → firestore-dedup → firestore-io`
and the repo chain `app-scope → article-repository → list-viewmodel`.

## Conflicts Found
None blocking. The shared-file edits above are all member-disjoint and resolved by the
recommended order. Two scope clarifications surfaced (recorded, not conflicts): efficiency-13
was already-correct in code (no-op), and `cross-cutting-url`'s "6 sites" is actually 4
Article-typed idiom sites (9 total, all byte-identical).

## Freshness Research
Carried from `02-shape.md` (Firestore `whereIn` cap 30 / WriteBatch 10 MiB-per-commit / Room
2.8 list-op auto-transactions / Coil 3 per-request `allowHardware` / Compose
`remember`/`derivedStateOf` / supervised app-scope). Two plan-time refinements:
collectionGroup proved infeasible for tags (no `userId` field → client-only), and the
palette/`allowHardware` concern dissolved entirely (palette dropped). No new external
constraint affects the plans.

## Recommended Next Stage
- **Option A (default):** `/wf implement simplify-android-app test-net` — implement the gate
  first; the chain depends on it being green. **Run `/compact` first** — planning research is
  noise for implementation; workflow state lives in the artifact files and the SessionStart
  hook re-reads them after compaction.
- **Option B (implement all, sequential):** start `/wf implement simplify-android-app test-net`
  and work the recommended order, parallelizing the independent slices where convenient.
- **Option C:** `/wf slice simplify-android-app` — only if you want to re-cut boundaries (not
  recommended; the DAG planned cleanly with zero blockers).
