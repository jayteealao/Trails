---
schema: sdlc/v1
type: implement
slug: simplify-android-app
slice-slug: fts-search-fix
status: complete
stage-number: 5
created-at: "2026-07-05T21:23:39Z"
updated-at: "2026-07-05T21:23:39Z"
metric-files-changed: 2
metric-lines-added: 162
metric-lines-removed: 1
metric-deviations-from-plan: 0
metric-review-fixes-applied: 0
commit-sha: "dea5423"
tags: [behaviour-change, bug, fts]
refs:
  index: 00-index.md
  implement-index: 05-implement.md
  slice-def: 03-slice-fts-search-fix.md
  plan: 04-plan-fts-search-fix.md
  siblings: [05-implement-test-net.md]
  verify: 06-verify-fts-search-fix.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app fts-search-fix"
---

# Implement: FTS search sanitization fix

## The Implementation

The FTS search bug was a one-character fix hiding a silent correctness failure: `ArticleRepositoryImpl.searchWithScore` computed a sanitized query — escaping internal double-quotes and wrapping the expression in phrase-prefix-suffix wildcards — then discarded it entirely, passing the raw input to the DAO's `MATCH` clause instead. Any query containing FTS special characters (`"`, `*`, `AND`, `OR`, `NEAR`) reached SQLite in unsanitized form, producing either malformed-MATCH failures or unintended operator semantics. The fix routes the already-computed `sanitizedQuery` variable to `searchArticlesWithMatchInfo` instead of `query`.

Seven unit tests in the new `FtsSearchTest` class pin the post-fix semantics for every edge-case category the plan specified: plain words, embedded quotes, lone asterisks, FTS operators, the empty-string early-return guard, whitespace-only input, and non-ASCII input. The tests use MockK DAO stubs and `coVerify` to assert the exact sanitized string reaching the DAO — they would all fail on the old code (the point), and pass green on the fixed code. The full unit-test suite (36 tasks) stayed green.

`searchHybrid` is confirmed dead (body commented out, logs only) and is unaffected. No caller signature changes. The DAO, FTS schema, and tokenizer are untouched.

## Summary of Changes

- **Bug fix** in `ArticleRepositoryImpl.searchWithScore`: pass `sanitizedQuery` to `articleDao.searchArticlesWithMatchInfo(...)` instead of raw `query`.
- **New test class** `FtsSearchTest` with 7 test cases covering all shape-mandated edge cases. All pass green.

## Files Changed

- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` — 1-line fix: `searchArticlesWithMatchInfo(query)` → `searchArticlesWithMatchInfo(sanitizedQuery)` at line 316.
- `android/app/src/test/java/com/jayteealao/trails/data/FtsSearchTest.kt` — new file (~161 lines): 7 test cases asserting post-fix DAO argument routing for all edge-case categories.

## Shared Files (also touched by sibling slices)

- `ArticleRepository.kt` is shared with `article-repository` and `app-scope` slices (different methods). This slice modifies only `searchWithScore`; the sibling slices modify `delete()`, `add()`, and the constructor. No merge conflict is expected given the distinct method boundaries.

## Notes on Design Choices

- **No change to `sanitizeSearchQuery`** — the existing escape logic is correct. The fix is purely routing its output to the DAO rather than discarding it.
- **MockK DAO stub, no Room in-process DB** — tests are JVM-only unit tests; the DAO is stubbed with `coEvery`. This is sufficient because the fix is an argument-routing error with fully mechanical verification via DAO-call assertion. No Room DB harness is needed.
- **`coVerify(exactly = 1)`** is used to assert both that the sanitized string reached the DAO and that the raw string did not (any call with a different argument would not match the `exactly = 1` expectation on the sanitized string).
- **TC-5 (empty query)** asserts `coVerify(exactly = 0) { articleDao.searchArticlesWithMatchInfo(any()) }` — the early-return guard in `searchWithScore` must fire before the DAO is ever called.

## Verification Seams Built

- AC A1 → `FtsSearchTest` (7 `coVerify` assertions on `articleDao.searchArticlesWithMatchInfo(sanitizedQuery)`) at `android/app/src/test/java/com/jayteealao/trails/data/FtsSearchTest.kt` — enables `:app:testDebugUnitTest --tests "com.jayteealao.trails.data.FtsSearchTest"` to observe it. All 7 pass.

## Visual Contract Honored

Not applicable — no `02c-craft.md` present.

## Deviations from Plan

None. The plan's 5 steps were executed exactly as written:
1. Bug confirmed at the planned line (316).
2. One-line fix applied.
3. `FtsSearchTest.kt` created at the planned path.
4. 7 test cases written with the planned input/expected pairs.
5. Tests run green; full suite run confirms no regressions.

## Anything Deferred

None for this slice. The plan explicitly deferred FTS schema/tokenizer changes (out of scope); that deferral stands.

## Known Risks / Caveats

- **Result-set change is intentional** — routing `sanitizedQuery` to the DAO changes returned rows for queries containing FTS special characters. This is the correction, not a regression. The new tests pin the post-fix expected behaviour only.
- **Double-wrap semantics** — the composed pattern for plain input is `*"*hello*"*` (phrase-prefix-suffix). This was the original intent of `sanitizeSearchQuery`; it was never exercised because the raw query bypassed it. Edge-case correctness is validated by TC-1 through TC-4 and TC-6/TC-7.

## Freshness Research

No new external research required. The plan's confirmed FTS4 semantics (phrase quoting neutralises operators; `*"..."*` is a valid prefix-suffix-phrase pattern; SQLite FTS4 docs) cover this fix completely. MockK 1.14.5 and coroutines-test are confirmed on the classpath from the `test-net` slice.

## Assumptions (autonomous decisions)

1. **test-net is green** — confirmed: commit `e2538b7` implements and verifies the test-net slice; the `05-implement-test-net.md` and `06-verify-test-net.md` files are present and the compile environment is known good.
2. **No `02b-design.md` / `02c-craft.md` / `04b-instrument.md` / `04c-experiment.md`** present for this workflow — confirmed by listing the workflow directory. No design or instrumentation augmentations to consume.
3. **No plan drift** — the bug line (316) is exactly where the plan said it would be. No file has been renamed or deleted. The sibling `05-implement-test-net.md` touched only test files; no conflict on production code.

## Recommended Next Stage

- **Option A (default):** `/wf verify simplify-android-app fts-search-fix` — run the AC gate: 7 FTS tests must pass, full suite must stay green. Tests are already green (confirmed in this session); verify formalizes the evidence.
- **Option B:** `/wf implement simplify-android-app streaming-restore` — proceed to the next slice while verify runs. The FTS fix is self-contained; no sibling dependency on its verify outcome.
