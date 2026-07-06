---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: fts-search-fix
status: complete
stage-number: 4
revision-count: 0
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 2
metric-step-count: 5
has-blockers: false
tags: [behaviour-change, bug, fts]
stack-source: confirmed
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-fts-search-fix.md
  siblings:
    - 03-slice-test-net.md
    - 03-slice-article-repository.md
  implement: 05-implement-fts-search-fix.md
next-command: wf-implement
next-invocation: "/wf implement simplify-android-app fts-search-fix"
---

# Plan

Fix the FTS search sanitization bug in `ArticleRepositoryImpl.searchWithScore`: change the
one call-site that passes the raw `query` to the DAO to pass the already-computed
`sanitizedQuery` instead. Pin the post-fix semantics with new FTS unit tests covering
all shape-mandated edge cases.

## Current State

`ArticleRepositoryImpl.searchWithScore` (line 297–312 of `ArticleRepository.kt`) computes:

```kotlin
val sanitizedQuery = sanitizeSearchQuery("*$query*")
Timber.d("sanitized query $sanitizedQuery")
return articleDao.searchArticlesWithMatchInfo(query)  // BUG: raw query, not sanitizedQuery
```

`sanitizeSearchQuery(query: String?)` (line 319–325) escapes internal double-quotes and wraps
the whole expression in `*"..."*`, producing e.g. `*"*hello world*"*`. This expression is
computed correctly but **silently discarded** — the raw `query` string is what actually
reaches the FTS4 `MATCH :query` clause in `searchArticlesWithMatchInfo`.

The FTS entity is `ArticleFts` (`@Fts4(contentEntity = Article::class)`, table `article_fts`,
columns `itemId`, `title`, `text`). The MATCH query is:

```sql
WHERE article_fts MATCH :query
```

`searchArticlesWithMatchInfo` is only called from `searchWithScore`, which is only called from
`searchLocal`. Callers of `searchLocal`: `ArticleListViewModel.searchLocal` and
`ArticleSearchViewModel.searchLocal`. No signature change is required.

## Reuse Opportunities

- `sanitizeSearchQuery` already exists and handles double-quote escaping + phrase wrapping.
  No new sanitization logic is needed — the fix is routing its output to the DAO.
- The `StandardTestDispatcher` + `runTest` pattern is already used in
  `ArticleListViewModelTest.kt`. The new FTS tests follow the same pattern.
- MockK (`io.mockk:mockk:1.14.5`) is already on the unit-test classpath; `coEvery`/`coVerify`
  are appropriate for the async DAO stub.

## Likely Files / Areas to Touch

| File | Role | Change |
|---|---|---|
| `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt` | Bug-fix | 1-line: `query` → `sanitizedQuery` in `searchArticlesWithMatchInfo(...)` call |
| `android/app/src/test/java/com/jayteealao/trails/data/FtsSearchTest.kt` | New test | ~120 lines; 7 test cases; MockK stub of ArticleDao |

No other files touched. `ArticleDao.kt`, `Article.kt`, `AppDatabase.kt` are read-only for
this slice.

## Proposed Change Strategy

Single hard-cutover patch to `searchWithScore`; no intermediate states, no compatibility
shim. The fix is self-contained within one private method: update the argument, run the new
tests, done. The new test class lives in the existing `data/` unit-test package and requires
no new test infra beyond what `test-net` provides (MockK + coroutines-test already present;
no Room DB needed for these tests — DAO is stubbed).

## Step-by-Step Plan

**Step 1 — Confirm the bug in code** (read-only exploration, already done in planning)
Verify line 303 of `ArticleRepository.kt` passes `query` not `sanitizedQuery` to
`searchArticlesWithMatchInfo`. No file change.

**Step 2 — Apply the one-line fix**
In `ArticleRepositoryImpl.searchWithScore`, change:
```kotlin
return articleDao.searchArticlesWithMatchInfo(query).let { results ->
```
to:
```kotlin
return articleDao.searchArticlesWithMatchInfo(sanitizedQuery).let { results ->
```
This is the complete production change.

**Step 3 — Create `FtsSearchTest.kt`**
New file at `android/app/src/test/java/com/jayteealao/trails/data/FtsSearchTest.kt`.
Use `@OptIn(ExperimentalCoroutinesApi::class)`, `StandardTestDispatcher`, `MockK`.
Construct a real `ArticleRepositoryImpl` with all unused constructor params mocked
(Context, SyncStatusMonitor, FirestoreSyncManager) and the MockK `articleDao`.

**Step 4 — Write 7 test cases**
Each test calls `articleRepository.searchLocal(input)` and asserts via
`coVerify { articleDao.searchArticlesWithMatchInfo(expectedSanitized) }`.

| # | Input | Expected DAO arg | Rationale |
|---|---|---|---|
| 1 | `"hello"` | `*"*hello*"*` | plain word — baseline |
| 2 | `"say \"hi\""` | `*"*say ""hi""*"*` | unbalanced/embedded quotes escaped |
| 3 | `"*"` | `*"***"*` | lone `*` stays literal inside phrase quotes |
| 4 | `"AND OR NEAR"` | `*"*AND OR NEAR*"*` | FTS operators neutralised in phrase |
| 5 | `""` (empty) | DAO never called; returns `emptyList()` | early-return guard |
| 6 | `"   "` (whitespace) | DAO called with `*"*   *"*` or equivalent; no crash | non-crashing |
| 7 | `"café résumé"` | `*"*café résumé*"*` | non-ASCII passes through unchanged |

**Step 5 — Run tests and verify green**
```
./gradlew :app:testDebugUnitTest --tests "com.jayteealao.trails.data.FtsSearchTest"
```
All 7 cases must pass. Also run the full unit-test suite to confirm no regressions:
```
./gradlew :app:testDebugUnitTest
```

## Test / Verification Plan

### Automated checks

- **Gradle task:** `./gradlew :app:testDebugUnitTest` (source set: `src/test/`, JVM unit tests)
- **Specific filter:** `--tests "com.jayteealao.trails.data.FtsSearchTest"`
- **What is pinned:** The INTENDED post-fix semantics — i.e., that `sanitizedQuery` (not raw
  `query`) reaches the DAO for every input category. Pre-fix behaviour (raw query to DAO) is
  **not** pinned anywhere; the old code path must be considered dead after this patch.
- **Behaviour-change notice:** Reviewers must not treat any change in search result rows as a
  regression. The diff in returned rows for queries containing FTS-special characters is the
  intentional correction (AC A1). Tests pin the post-fix intended behaviour only.
- **Dependency on test-net:** The unit-test compile environment requires `DefaultArticleRepositoryTest`
  to compile (from the `test-net` slice). These FTS tests do NOT use a Room in-process DB;
  the DAO is MockK-stubbed. But the package/compile setup from `test-net` must be green first.

### Interactive verification

None required for this slice. The bug is an argument-routing error with fully mechanical
verification via the DAO-call assertion. No UI / emulator run needed for AC A1.

## Risks / Watchouts

1. **Result-set change is intentional** — Routing `sanitizedQuery` to the DAO will change
   returned rows for queries containing FTS-special chars. This is the intended correction.
   Reviewers must not flag it as a regression. The new tests pin the post-fix expected
   behaviour; they will fail on the old code (which is the point).

2. **Double-wrap semantics** — `searchWithScore` calls `sanitizeSearchQuery("*$query*")` and
   `sanitizeSearchQuery` itself wraps in `*"..."*`. The composed result for input `"hello"` is
   `*"*hello*"*`. This is a phrase-prefix-suffix query in FTS4. Verify it produces correct
   (not overly broad or empty) matches in the edge-case tests. If the double-wrap is too
   aggressive, adjust `sanitizeSearchQuery` — but that adjustment is **within scope** of this
   slice since it is part of the same method cluster.

3. **Callers are internal, no signature change** — `searchLocal` → `searchWithScore` →
   DAO. `ArticleListViewModel` and `ArticleSearchViewModel` call `searchLocal(query: String)`.
   No caller update needed (hard cutover is entirely internal).

## Dependencies on Other Slices

- **test-net (prerequisite):** `fts-search-fix` must land after `test-net` has revived the
  compile environment (`DefaultArticleRepositoryTest` compiles, `TestDatabaseModule` ready).
  The new FTS tests are JVM-only and do not use the Hilt DB harness directly, but the
  shared test-compile setup from `test-net` is still required.
- **article-repository (sibling, later):** Both slices touch `ArticleRepository.kt` but at
  different methods. `fts-search-fix` modifies `searchWithScore`; `article-repository` modifies
  `delete()` and `add()` (and the constructor for app-scope injection). Sequence
  `fts-search-fix` first to reduce merge churn, then `article-repository` patches the
  constructor/other methods cleanly onto the already-fixed file.
- **app-scope (sibling, later):** Also touches the constructor. Same sequencing applies.

## Assumptions

1. The FTS4 MATCH expression `*"*hello*"*` (prefix-phrase-suffix) is valid SQLite FTS4 syntax
   and produces sensible results. This is the behaviour `sanitizeSearchQuery` was originally
   designed to emit; no FTS schema or tokenizer change is in scope.
2. The test-net slice has landed and the compile environment is green before this slice runs.
3. MockK 1.14.5 (already on classpath) is sufficient for DAO stubbing without a real Room DB.
4. `searchHybrid` is effectively dead code (body is commented out and logs only) and is not
   affected by this fix.

## Blockers

None. The fix is one line; the test infra (MockK + coroutines-test) is already present.
Blocked only on `test-net` being green (soft predecessor, not a hard blocker on planning).

## Freshness Research

### Room FTS4 MATCH semantics (from shape + inline analysis)

Carried from `02-shape.md` Freshness Research section. No new search required for this slice —
the fix is an argument-routing correction, not an FTS schema or tokenizer change.

Key confirmed points:
- **Room `@Fts4`** generates a virtual table; MATCH queries use SQLite FTS4 tokenizer.
- **FTS4 MATCH special chars:** `"` (phrase), `*` (prefix/suffix), `AND`/`OR`/`NOT`/`NEAR`
  (operators). Bare use of these in the raw query causes either malformed-MATCH errors or
  unintended operator semantics.
- **`sanitizeSearchQuery` escape strategy:** wraps the whole expression in `"..."` (phrase
  quotes) after escaping internal `"` to `""`. This neutralises AND/OR/NEAR/`*` as operators
  within the phrase. The outer `*"..."*` adds prefix/suffix wildcard to the phrase — a valid
  FTS4 pattern.
- **Source:** SQLite FTS4 documentation + Room 2.8 query reference (confirmed in shape stage).
  No new web search was performed; shape's research covers the required semantics.

## Revision History

(none — rev 1 is the initial plan)

## Recommended Next Stage

`/wf implement simplify-android-app fts-search-fix`

Apply the one-line fix to `searchWithScore` in `ArticleRepository.kt`, create
`FtsSearchTest.kt` with the 7 test cases, run `./gradlew :app:testDebugUnitTest` to confirm
green. Prerequisite: `test-net` slice must be implemented and green first.
