---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: article-repository
status: complete
stage-number: 5
created-at: "2026-07-05T23:42:26Z"
updated-at: "2026-07-05T23:42:26Z"
metric-files-changed: 3
metric-lines-added: 104
metric-lines-removed: 13
metric-deviations-from-plan: 1
metric-review-fixes-applied: 0
commit-sha: ""
tags: [behaviour-preserving, repository, di, efficiency]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-article-repository.md
  plan: 04-plan-article-repository.md
  siblings:
    - 05-implement-test-net.md
    - 05-implement-fts-search-fix.md
    - 05-implement-app-scope.md
    - 05-implement-streaming-restore.md
    - 05-implement-batched-tag-reads.md
    - 05-implement-firestore-dedup.md
    - 05-implement-firestore-io.md
  verify: 06-verify-article-repository.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app article-repository"
---

# Implement: ArticleRepository cleanup (quality-2 + efficiency-10 / B3)

## The Implementation

Two independent defects in `ArticleRepositoryImpl` are resolved in a single coherent pass.
The first removes two raw `FirebaseAuth.getInstance()` / `FirebaseFirestore.getInstance()`
calls from `delete()` and replaces them with constructor-injected handles — closing a DI gap
that made the method untestable and implicitly relied on Firebase static initialisation order.
The second replaces a per-item `upsertArticle()` loop inside `add()` with a single
`upsertArticles(List)` call, cutting N individual write transactions down to one auto-transactional
`@Upsert` call for however many articles arrive in a batch.

Both changes are structurally clean: the two new constructor params (`FirebaseFirestore`,
`FirebaseAuth`) are `@Singleton` providers already in the DI graph via `FirestoreModule` and
`FirebaseModule`. Hilt resolves them automatically through the existing `@Binds` in `DataModule`
— no new module, no explicit `@Provides` listing. The `@Upsert(List)` method `upsertArticles`
was already present in `ArticleDao`; this slice just routes calls to it.

The observable behaviour is unchanged: the soft-delete Firestore write still fires; article
upsert-conflict semantics are identical (same `@Upsert` annotation, same primary-key conflict
strategy). Three tests in `DefaultArticleRepositoryTest` are now green — the existing `pockets`
delegation test plus two new tests that pin the injected-Firebase and bulk-upsert paths
respectively. The full unit-test suite (all 14 test classes) stays green with 0 failures.
One plan-versus-reality deviation was recorded: `FtsSearchTest.setUp()` also constructs
`ArticleRepositoryImpl` directly and needed the same constructor extension, which the plan did
not list as a touched file. The fix is mechanical and in-scope.

## Summary of Changes

- **MODIFIED** `ArticleRepository.kt` — constructor extended with `FirebaseFirestore` and `FirebaseAuth`
  params; `FirebaseAuth`, `FirebaseFirestore`, `SetOptions` imports added; `delete()` raw `getInstance()`
  calls replaced with injected handles; `add()` single `forEach` split into map-then-bulkUpsert pass
  followed by a second `forEach` for associated data.
- **MODIFIED** `DefaultArticleRepositoryTest.kt` — `@MockK` fields added for `FirebaseFirestore` and
  `FirebaseAuth`; `testDispatcher` extracted; `setUp` updated to relaxed init and new params; two
  new test methods: `delete uses injected FirebaseAuth and FirebaseFirestore` and
  `add performs single bulk article upsert`.
- **MODIFIED** `FtsSearchTest.kt` — `@MockK` fields added for `FirebaseFirestore` and `FirebaseAuth`;
  `setUp` updated to relaxed init and new constructor params. (Deviation from plan — see below.)

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — constructor,
  imports, `delete()`, `add()` as described
- `android/app/src/test/java/com/jayteealao/trails/data/DefaultArticleRepositoryTest.kt` —
  extended with Firebase mocks and two new test methods
- `android/app/src/test/java/com/jayteealao/trails/data/FtsSearchTest.kt` — constructor call
  updated to pass new params (compile-correctness fix; no new assertions added)

## Shared Files (also touched by sibling slices)

- `ArticleRepository.kt` — `fts-search-fix` touched `searchWithScore` (different method);
  `app-scope` touched constructor and imports (already merged). This slice adds two new constructor
  params and edits `delete()` + `add()`. No conflicts with prior sibling changes.

## Notes on Design Choices

- **`SetOptions` imported at the top instead of inline** — the `delete()` body previously used
  `com.google.firebase.firestore.SetOptions.merge()` fully-qualified inline. The refactored version
  imports it at the top alongside the other Firebase imports, consistent with the file's existing
  import style for the other Firebase types.
- **Two-pass `add()` instead of a combined loop** — the plan specifies this split explicitly.
  The alternative (a single `forEach` that maps-and-upserts-per-item) would not reduce DB write
  count. The two-pass approach is the only shape that delivers the bulk-upsert benefit while
  keeping associated-data inserts correct per their source `ArticleData` owner.
- **`relaxed = true` on `MockKAnnotations.init`** — the `delete()` test sets up a deep
  Firestore method chain (`collection → document → collection → document → set`). Using
  `relaxed = true` for the global init means only the chains we explicitly stub need setup;
  unstubbed calls on relaxed mocks return default values rather than throwing. This is consistent
  with the existing pattern in `ArchiveServiceTest`.
- **`FtsSearchTest` update** — the plan named 2 files (impl + test); a third file
  (`FtsSearchTest.kt`) also constructs `ArticleRepositoryImpl` directly and required the same
  constructor extension for compile correctness. No new test assertions were added to `FtsSearchTest`.

## Verification Seams Built

- **B3 delete injection** → `DefaultArticleRepositoryTest.delete uses injected FirebaseAuth and FirebaseFirestore`
  at `android/app/src/test/java/com/jayteealao/trails/data/DefaultArticleRepositoryTest.kt`
  (enables `./gradlew :app:testDebugUnitTest --tests "*.DefaultArticleRepositoryTest"` to
  verify the injected-handles AC directly; the absence of `mockkStatic` means any call to the
  static `getInstance()` path would throw).
- **B3 bulk upsert** → `DefaultArticleRepositoryTest.add performs single bulk article upsert`
  at the same file (enables `coVerify(exactly = 1) { upsertArticles }` + `coVerify(exactly = 0) { upsertArticle }`
  to assert the N-to-1 reduction).

## Visual Contract Honored

N/A — no `02c-craft.md` present.

## Deviations from Plan

- **`FtsSearchTest.kt` not in plan's file list** — the plan's `## Likely Files / Areas to Touch`
  listed only `ArticleRepository.kt`, `DefaultArticleRepositoryTest.kt`, and `DataModule.kt`
  (verify-only). `FtsSearchTest.kt` was not listed but also constructs `ArticleRepositoryImpl`
  directly. After the constructor signature change, it would fail to compile without the new
  params. Fix applied: added `@MockK` fields and updated `setUp()` constructor call. No
  behavioral change to `FtsSearchTest` tests; no new assertions; fully within scope.
- **`DataModule.kt` verify step** — confirmed by inspection: uses `@Binds` with no explicit
  constructor listing; Hilt resolves the two new params automatically. No edit required
  (matches the plan's Step 5 expectation).

## Anything Deferred

None. All scope of this slice delivered in this pass. The plan explicitly deferred:
- Associated-data bulk-optimization (images, videos, tags, authors, domainMetadata stay
  per-datum in a second `forEach` — out of scope, as the plan noted they are already list-based).
- Moving ViewModel DAO calls behind the repo (→ `list-viewmodel` slice, B5).

## Known Risks / Caveats

- **Two-pass `add()` is not wrapped in a `@Transaction`** — this matches the original code.
  Article upserts land first; associated-data inserts follow. A crash between the two passes
  would leave articles without their associated data. Adding a transaction wrapper would be
  out of scope and could introduce lock contention; the risk is the same as before (and the
  plan explicitly noted this).

## Assumptions (Autonomous Decisions)

1. **`app-scope` has landed** — confirmed: `ArticleRepositoryImpl` constructor contains
   `@ApplicationScope coroutineScope` and no `ioDispatcher`. Commit `21a1c8c` is present.
2. **`fts-search-fix` has landed** — confirmed: `FtsSearchTest.kt` is present; `searchWithScore`
   uses `sanitizedQuery`. Commit `dea5423` is present.
3. **`articleDao.upsertArticles` is `@Upsert`** — confirmed: line 239–240 of `ArticleDao.kt`.
   Same conflict strategy as `upsertArticle`; switching from N calls to 1 call preserves semantics.
4. **No `02b-design.md` / `02c-craft.md` / `04b-instrument.md` / `04c-experiment.md`** present
   for this workflow — confirmed by directory listing. No design or instrumentation augmentations
   to consume.
5. **`relaxed = true` for MockKAnnotations** is safe here because the `delete()` test explicitly
   stubs the Firestore chain it needs and verifies the calls it cares about.

## Freshness Research

No new external research required. Firebase DI injection vs. raw `getInstance()` is a standard
Android/Hilt pattern. Room `@Upsert(List)` auto-transactional guarantee is covered by the
plan's freshness research (Room 2.8 docs, confirmed via `02-shape.md`). No library version
changes affect this slice.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app article-repository` — run the AC gate:
  existing test green + 2 new tests green + no regressions in any sibling test class. Tests are
  already confirmed green in this session; verify formalizes the evidence.
- **Option B:** `/wf implement simplify-android-app detail-viewmodel` — proceed to the next
  planned slice while verify runs. `article-repository` (B3) is a prerequisite for `list-viewmodel`
  (B5), which may start after B3 is merged.
