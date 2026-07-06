---
schema: sdlc/v1
type: shape
slug: simplify-android-app
status: complete
stage-number: 2
revision-count: 0
created-at: "2026-06-14T20:01:16Z"
updated-at: "2026-06-14T20:01:16Z"
docs-needed: true
docs-types: [reference, explanation]
slicing-axis: by-code-area
slicing-order: risky-three-first
deferrals-allowed: true
tags: [refactor, android, cleanup, simplify]
refs:
  index: 00-index.md
  intake: 01-intake.md
  source-triage: "../../simplify/20260613T0415Z.md"
  next: 03-slice.md
next-command: wf-slice
next-invocation: "/wf slice simplify-android-app"
---

# Shape

## Problem Statement
A codebase-scope review of the Trails Android app (`android/app/src/main/java/com/jayteealao/trails`,
109 Kotlin files, ~9k LOC) produced 37 accepted findings — 11 reuse, 13 quality, 13 efficiency —
concentrated in the Firestore sync/backup layer (`FirestoreSyncManager`, `FirestoreBackupService`,
`ArticleRepository`) and the article-list UI (`ArticleListItem`, `AdaptiveArticleGrid`,
`ArticleThumbnail`). Most are behaviour-preserving cleanups (duplication, dead code, stringly-typed
keys, leaky abstractions, recomposition cost). Three are not:

- **quality-8** — a real logic bug: `ArticleRepository.searchWithScore` computes `sanitizedQuery`
  then passes the **raw** query to the DAO, so FTS sanitization/wildcards are silently discarded.
- **efficiency-4** — N+1 Firestore reads of a per-article `tags` subcollection during restore.
- **efficiency-5** — paginated restore re-accumulates every page into one in-memory list → OOM on
  large libraries (and the current "paginated" method defeats its own purpose).

The app must get cheaper to maintain (less duplication, no dead code, cleaner DI/lifecycle) and
cheaper to run (fewer Firestore round-trips, bulk Room ops, no per-frame Compose work, less memory)
**without changing user-visible behaviour** — except where a finding *is* an intentional fix
(quality-8) or a resource-safety improvement (efficiency-4/5).

## Primary Actor / User
- **Primary:** the app maintainer/developer (code health, reviewability, build/runtime cost).
- **Indirect:** end users on low-memory devices and large libraries — restore stops OOMing, the
  article list scrolls without per-frame HTML parsing or stray infinite animations, and search
  (FTS) returns correct, sanitized results.

## Desired Behavior
1. The 37 findings are resolved — or explicitly deferred with a recorded reason — across a set of
   **code-area slices** on `feat/simplify-android-app`, with the **three behaviour-changing items
   sequenced first** (each with its own acceptance criteria + tests).
2. Behaviour-preserving refactors leave runtime behaviour identical; the only intentional changes
   are quality-8 (corrected FTS results), efficiency-4 (fewer reads, same data), and efficiency-5
   (constant-memory restore).
3. The Firestore sync/backup duplication collapses to single sources (collection constants,
   auth-guard helper, `addArticleToBatch`, chunked-apply helper, tag-backup via `backupArticle`),
   and per-item commits/deletes become per-chunk batches / bulk Room ops.
4. The article list does **no** per-recomposition `HtmlCompat.fromHtml`, runs **no** dead infinite
   animation, and decodes thumbnails efficiently (hardware bitmaps unless a palette genuinely needs
   software — to be confirmed by tracing palette consumers).

## Acceptance Criteria
Each criterion is tagged `automated` / `interactive` / `manual`.

**Behaviour-changing (land first — A1–A4):**
- **A1 (quality-8, `automated`)** — Given a search query containing FTS-special characters (quotes,
  `*`, operators) When `searchWithScore(query)` runs Then the DAO receives the **sanitized**
  query and results reflect the intended sanitized + wildcard/prefix semantics. Pin with new FTS
  tests; pre-fix result sets are expected to change.
- **A2 (efficiency-5, `automated` + `interactive`)** — Given a large remote library restored on a
  new device When `restoreAllArticlesPaginated` (or its successor) runs Then memory stays bounded:
  each page is written to Room as it arrives and is not retained. Verify with a streaming-API test
  (no full-list accumulation) and a manual restore smoke on emulator (Android Studio memory
  profiler / logcat — no sustained heap growth across pages).
- **A2b (adjacent fix, `automated`)** — Given a restored article whose text exceeded the >900KB
  inline limit When bulk restore runs Then its large text is rehydrated from the `text`
  subcollection (parity with single-article `restoreArticle`). (Adjacent latent bug, fixed in
  scope per PO.)
- **A3 (efficiency-4, `automated` + `manual`)** — Given a bidirectional restore with N remote
  articles When tags are fetched Then total Firestore tag reads are sub-N+1 (batched). Approach
  (collectionGroup+index+rules vs chunked `whereIn` ≤30) and any deploy gating are **decided in
  efficiency-4's plan**. Verify read-count reduction via test/instrumentation; if a composite
  index or rules change is required, it is deployed + verified live per that plan.
- **A4 (quality-1 + scope, `automated`)** — Given the app DI graph When a long-lived background
  scope is needed Then a single Hilt `@Singleton @ApplicationScope CoroutineScope(SupervisorJob() +
  dispatcher)` is provided and injected into `ArticleRepository`, with `FirestoreSyncManager`'s
  ad-hoc scope consolidated onto it. A child failure must not cancel siblings.

**Behaviour-preserving clusters (B-series, `automated` + review):**
- **B1 (Firestore dedup)** — reuse-1,2,3,4,7 (+quality-3): collection constants in one place,
  `withAuthenticatedUser { }` guard, `addArticleToBatch(...)`, `applyRemoteArticles(...)`,
  tag-backup delegated to `backupArticle`. Behaviour identical; pinned by **characterization tests
  written first** against current `FirestoreSyncManager`/`FirestoreBackupService` behaviour.
- **B2 (Firestore read/write efficiency)** — efficiency-1 (single user-meta read), efficiency-2
  (per-chunk batch commit), efficiency-3 (bulk tag-delete DAO). Same outputs, fewer ops.
- **B3 (ArticleRepository)** — quality-2 (inject Firebase, drop `getInstance()` in `delete()`),
  efficiency-10 (bulk DAO insert in `add()`), plus A4.
- **B4 (ArticleDetailViewModel)** — quality-4 (nested `combine()` to drop 9 unchecked casts),
  quality-6 (`SettingsPreferenceKeys.USE_FREEDIUM`), reuse-5 (`@Singleton UrlModifier`),
  reuse-11 (`ArchiveType` enum).
- **B5 (ArticleListViewModel)** — quality-5 (delete dead `_articles`), quality-12 (delete
  commented `sync()`), **quality-11 broadened** (move ALL direct DAO usage behind the repository,
  not just the named sites), reuse-6 (delete pass-through `GetArticleWithTextUseCase`, call
  `articleRepository.pockets()`).
- **B6 (article-list UI)** — efficiency-6 (remove dead infinite gradient animation), efficiency-7
  (`remember(article.snippet)` the HTML parse), efficiency-8 (`remember(tags)` tag state),
  quality-9 (single-source `isFavorite`/`isRead` init), reuse-8/quality-10 (extract shared Grid/List
  action callbacks), quality-13 (**remove** the empty `NavigateToArticle` registration).
  Verified by **Compose UI tests + manual scroll**; appearance must not change.
- **B7 (SyncWorker)** — efficiency-9 (`syncJob.join()` not `delay(5000)` poll), efficiency-11
  (paginate non-metrics article load), reuse-9/quality-7 (remove dead `syncArchivesInBackground`
  or delegate to `ArchiveService`; drop raw `getInstance()`).
- **B8 (ArticleThumbnail)** — efficiency-12: **first trace palette consumers**; if the palette only
  fed the removed gradient (efficiency-6) → drop palette extraction entirely; else scope
  `allowHardware(false)` to a dedicated per-request palette load so display images stay
  hardware-backed (Coil 3 guidance). efficiency-13 (`text.length` heuristic vs `toByteArray().size`).
- **B9 (cross-cutting)** — reuse-10 (`Article.computeNormalizedUrl()` extension, replace 6 sites).

**Test-infra enablement (E-series, supports the net):**
- **E1 (`automated`)** — Revive the disabled Hilt test module (`TestDatabaseModule`) and
  `DefaultArticleRepositoryTest` as needed so characterization + new tests can run. Repair only
  what the regression net requires.

## Non-Functional Requirements
- **Behaviour-preserving by default.** Only A1–A4/A2b intentionally change behaviour.
- **No new user-facing features, no UI redesign, no dependency upgrades.**
- **android/ only.** Do not touch the `warg/` Cloudflare stack. The shared Firestore project
  `trails-e428e` may receive an index (and possibly rules) **only** if efficiency-4's plan elects
  the collectionGroup approach — gating decided there.
- **Per-slice safety bar.** Risk posture scales to blast radius (a Firestore-sync change ≠ a
  dead-code deletion).
- **Hard cutover** for internal API changes (all callers are in-app); no deprecation shims.

## Edge Cases / Failure Modes
- **FTS (A1):** queries with unbalanced quotes, lone `*`, FTS operators (`AND`/`OR`/`NEAR`),
  empty/whitespace query, non-ASCII. New tests must cover malformed-MATCH avoidance.
- **Streaming restore (A2):** zero articles; a single page; a page-write failure mid-stream
  (partial restore state); cancellation; the >900KB large-text rehydration path (A2b).
- **Batched tags (A3):** article with no tags; >30 article IDs (chunking); a missing/denied tag
  read; collectionGroup rules gap (query fails entirely if any candidate doc is uncovered).
- **App scope (A4):** a child coroutine throwing must not tear down the scope; verify supervised
  isolation. Avoid premature `.cancel()` on the singleton scope.
- **Compose (B6):** removing the infinite animation must not leave a referenced-but-undefined value;
  `remember` keys must invalidate correctly when `article.snippet`/`tags` change.
- **Thumbnail (B8):** if palette is dropped, ensure nothing downstream reads the removed colors; if
  kept, hardware bitmaps must not reach `Palette.Builder` (throws on HARDWARE config).
- **DAO-behind-repo (B5):** moving ViewModel DAO calls behind the repository must preserve threading
  (dispatcher) and transaction semantics.

## Affected Areas
(from the codebase scan — paths under `android/app/src/main/java/com/jayteealao/trails`)
- `services/firestore/FirestoreSyncManager.kt` — auth-guard, constants, tag-backup, chunked-apply,
  user-meta read, per-chunk batch, bulk tag-delete, N+1 tag reads, ad-hoc scope.
- `services/firestore/FirestoreBackupService.kt` — `addArticleToBatch` extraction, large-text dedup,
  `restoreAllArticlesPaginated` streaming + large-text rehydration, deprecated `restoreAllArticles`
  removal, `toByteArray().size` heuristic. Collection constants live here (companion object).
- `data/ArticleRepository.kt` (interface + impl) — FTS bug, injected Firebase in `delete()`, bulk
  `add()`, supervised injected scope.
- `screens/articleDetail/ArticleDetailViewModel.kt` — nested combine, `@Singleton UrlModifier`,
  settings key, archive enum.
- `screens/articleList/ArticleListViewModel.kt` — dead `_articles`, commented `sync()`, DAO-behind-
  repo (broadened), delete pass-through use case.
- `screens/articleList/components/ArticleListItem.kt`, `AdaptiveArticleGrid.kt`,
  `ArticleThumbnail.kt`, `screens/articleList/ArticleListScreen.kt` (quality-13).
- `sync/workers/SyncWorker.kt` (+ archive worker) — join, pagination, dead method, `getInstance()`.
- New DI: a `@Singleton @ApplicationScope CoroutineScope` provider (`di/`).
- `usecases/GetArticleWithTextUseCase.kt` — delete.
- Tests: `src/test/.../data/DefaultArticleRepositoryTest.kt`,
  `src/androidTest/.../testdi/TestDatabaseModule.kt` (revive), new FTS + sync characterization +
  Compose UI tests.
- Possible (efficiency-4 only): `firebase/firestore.indexes.json`, `firebase/firestore.rules`.

## Dependencies / Sequencing Notes
- **Order:** risky three first (A1 → A2/A2b → A3 → A4), then B-series by area, with **E1 (test
  infra)** and **B1 characterization tests** standing up the net *before* the dedup refactors land.
- **efficiency-4 (A3) is the only potentially deploy-gated item** — its plan decides
  collectionGroup+index+rules vs chunked `whereIn`, and the deploy gating. Treat as its own slice.
- **efficiency-6 ↔ efficiency-12 coupling (B6/B8):** resolve B6 (dead animation) understanding may
  eliminate B8's palette/allowHardware work — trace consumers in B8's plan.
- **Hard cutover** means each internal-signature change updates all in-app callers within its slice.
- Slicing axis = **by code area**; final slice list is `/wf slice`'s job. This shape sets the axis,
  the order, the clusters above, and per-cluster acceptance criteria.

## Questions Asked This Stage
20 questions across 5 rounds (core scope; risky-item contracts + regression net; surface/UI/stack;
failure modes/risk; boundaries/transitions/blockers). Full text + answers in `po-answers.md`
(2026-06-14 — shape).

## Answers Captured This Stage
Slicing **by code area**, **risky-3-first**, deferrals allowed with reason, quality-13 removed;
efficiency-4 & efficiency-5 API approaches **deferred to plan**, **shared @ApplicationScope** added,
**characterization tests first**; **Compose UI tests + manual scroll**, **investigate palette
consumers first**, **stack corrected** (drop robolectric+macrobenchmark), **DoD adopted as-is**;
**fix adjacent bugs in scope**, **pin FTS behaviour with tests**, efficiency-4 deploy gating at its
plan, **risk bar per slice**; extra scope = **revive test infra + remove deprecated
restoreAllArticles() + broaden quality-11**, **hard cutover**, **full Diátaxis docs**, **no
blockers**.

## Out of Scope
- New features; UI redesign; dependency upgrades.
- Any change to the `warg/` Cloudflare stack.
- Firestore **rules** changes — except if efficiency-4's plan elects collectionGroup (then index +
  rules on `trails-e428e`, gated in that plan). No other schema change.
- Findings beyond the 37 + adjacent-to-touched bugs + the three explicitly-added scope items
  (revive test infra, remove deprecated `restoreAllArticles()`, broaden quality-11). Everything
  else → recorded follow-up.

## Definition of Done
1. All 37 findings resolved, or explicitly deferred with a recorded reason.
2. No behavioural regressions: existing tests stay green; new tests cover quality-8 (FTS), the
   restore changes (efficiency-4/5 + A2b), the new app-scope, and any extracted helper.
3. Firestore sync/backup duplication removed (single source for tag-backup, collection constants,
   auth-guard, large-text handling); per-chunk batching + bulk Room ops replace per-item commits.
4. Article list does no per-recomposition HTML parsing and runs no dead animation; thumbnails
   decode efficiently.
5. Characterization tests pin the Firestore layer before its dedup refactors; revived test infra
   (`TestDatabaseModule`, `DefaultArticleRepositoryTest`) runs.
6. Full Diátaxis docs delivered (see Documentation Plan).

## Verification Strategy
**Automated checks (CI / test suite):**
- New FTS tests for quality-8 (A1); streaming-restore + large-text-rehydration tests (A2/A2b);
  tag-read-count reduction test (A3); supervised-scope test (A4); characterization tests for the
  Firestore dedup (B1); Compose UI-test assertions for ArticleListItem state + Grid/List parity
  (B6); unit coverage for extracted helpers and bulk DAO ops.
- Revive `TestDatabaseModule` + `DefaultArticleRepositoryTest` (E1) so Hilt-backed repo/DB tests run.

**Interactive verification (run the app):**
- Platform: **Android** (emulator/device).
- Tool: Android Studio run + memory profiler + **lazylogcat** for sync/worker traces; manual scroll
  of the article list.
- What to verify: restore of a large library stays memory-bounded (A2); list scroll is smooth with
  no visual change after B6/B8; sync/restore round-trip works end to end.
- Evidence: heap profile / logcat across restore pages; before/after scroll screenshots; sync logs.

**Human-in-the-loop checks:**
- Code review (slug-wide at handoff) confirms the behaviour-preserving refactors preserve behaviour;
  per-slice risk bar applied; efficiency-4 deploy (if any) verified live before its code merges.

## Documentation Plan
Per PO: **full Diátaxis pass** (reference + explanation; no tutorial — audience is the maintainer).

- **Explanation** — "Firestore sync/backup architecture (post-cleanup)": the single-source
  collection constants, `withAuthenticatedUser` guard, `addArticleToBatch`/`applyRemoteArticles`
  helpers, streamed restore contract, and the batched-tag-read approach (incl. any index/rules if
  efficiency-4 deploys). *Must cover:* the new shape and why; the streamed-restore memory contract;
  the FTS sanitization fix and its result-set impact. *Must NOT cover:* per-line change logs (those
  live in the PR), warg internals. *Location:* `docs/architecture/` (or repo docs root).
- **Explanation** — "App-scope & DI conventions": the new `@ApplicationScope @Singleton
  CoroutineScope(SupervisorJob()+dispatcher)`, when to use it vs `viewModelScope`, and why bare
  `CoroutineScope(dispatcher)` is a reliability bug. *Must NOT cover:* general Hilt tutorial.
- **Reference** — If efficiency-4 deploys infra: document the `firestore.indexes.json`
  collectionGroup index + any rules match (fields, scope, rationale) so the shared-project change is
  traceable. Otherwise: a short reference note on the batched-tag-read query shape.
- **README update** — one line noting the corrected FTS search behaviour (user-visible) and the
  restore memory fix, if the README surfaces app capabilities. Boundary: no internal workflow refs.

If efficiency-4 stays client-only (chunked `whereIn`), the index/rules reference doc is dropped.

## Freshness Research
(from the dependency-freshness scan; pins confirmed from `android/gradle/libs.versions.toml`)
- **Firestore collectionGroup (efficiency-4)** — A `collectionGroup` query with a filter requires a
  `COLLECTION_GROUP`-scoped composite index **and** a `rules_version='2'` wildcard rules match;
  `whereIn` is capped at **30** values (chunk IDs). Source: Firestore index/queries/rules docs.
  Takeaway: collectionGroup is **deploy-gated** on the shared project — decide in efficiency-4 plan.
- **WriteBatch (efficiency-2)** — the 500-doc/batch hard limit is gone; real cap is 10 MiB/commit +
  270s txn. Keep ~500 chunks for throughput hygiene, not correctness. Source: Firestore txn/quotas.
- **Room 2.8.0 (efficiency-3/10)** — `@Insert(List)`/`@Delete(List)` are auto-transactional; use
  `@Transaction`/`withTransaction {}` only for multi-op atomicity; `DELETE … WHERE parentId` for
  cascade deletes. KSP (not kapt) on Kotlin 2.x. Source: Room docs.
- **Coil 3.3.0 (efficiency-12)** — scope `allowHardware(false)` to a **per-request** palette load
  (HARDWARE bitmaps throw in `Palette`); never disable it globally on the `ImageLoader`. Source:
  Coil 3 recipes.
- **Compose BOM 2025.09.00 (efficiency-6/7/8)** — `remember(key) { HtmlCompat.fromHtml(...) }`; no
  synchronous parse in `LaunchedEffect`; remove unused `rememberInfiniteTransition`;
  `derivedStateOf` for scroll-derived booleans. Source: Compose performance/stability docs.
- **Coroutine scope (quality-1)** — `CoroutineScope(SupervisorJob() + dispatcher)` under
  `@Singleton @ApplicationScope`; bare `CoroutineScope(dispatcher)` dies on first child exception.
  Source: Android/Manuel Vivo Hilt-scope guidance.
- **CVEs** — no known vulnerable pin (firebase-bom 34.6.0, Coil 3.3.0, Room 2.8.0, Paging 3.3.6).
  Note: `firebaseAuth = 24.0.1` is pinned outside the BOM (version-skew maintenance risk) — flag
  only, not in scope.

## Recommended Next Stage
- **Option A (default):** `/wf slice simplify-android-app` — 37 findings across many files with a
  chosen **by-code-area** axis and **risky-3-first** order; the B-clusters + E1 above map cleanly to
  shippable slices. This is the right next step.
- **Option B:** `/wf plan simplify-android-app` — only if you treat the whole set as one unit; not
  recommended (the risky three + characterization-test sequencing want distinct slices).
- **Option C:** `/wf intake simplify-android-app` — revisit intake; not applicable (no brief defect
  surfaced).
