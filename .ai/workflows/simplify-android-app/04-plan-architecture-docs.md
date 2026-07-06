---
schema: sdlc/v1
type: plan
slug: simplify-android-app
slice-slug: architecture-docs
status: complete
stage-number: 4
created-at: "2026-06-14T22:46:55Z"
updated-at: "2026-06-14T22:46:55Z"
metric-files-to-touch: 4
metric-step-count: 7
has-blockers: false
revision-count: 0
stack-source: confirmed
tags: [docs, diataxis, explanation, reference]
refs:
  index: 00-index.md
  plan-index: 04-plan.md
  slice-def: 03-slice-architecture-docs.md
  siblings:
    - 03-slice-firestore-dedup.md
    - 03-slice-app-scope.md
    - 03-slice-batched-tag-reads.md
  implement: 05-implement-architecture-docs.md
next-command: wf-verify
next-invocation: "/wf verify simplify-android-app architecture-docs"
---

# Plan: Diátaxis documentation (Definition-of-Done item 6)

## Current State

`docs/` at the repo root contains only `docs/runbooks/` (operational runbooks for firebase/signing
issues). There is no `docs/architecture/` directory. The `README.md` at the repo root describes the
monorepo structure and how the two stacks connect, but contains no mention of the Android sync/backup
architecture, FTS search behaviour, or restore memory contract.

The architecture to be documented is the **post-cleanup shipped shape** from the five structural slices
(`app-scope`, `firestore-dedup`, `firestore-io`, `streaming-restore`, `batched-tag-reads`). This slice
lands last and documents what those slices delivered — it does not propose further code changes.

## Reuse Opportunities

- The `docs/runbooks/` directory establishes Markdown as the doc format and `docs/` as the root. The
  new `docs/architecture/` directory follows the same pattern.
- The README already has a `| android/ | ... |` table row describing the Android client. A one-line
  capability note fits inline there without structural change.
- No existing architecture docs to match style against — the style is established by this slice.

## Likely Files / Areas to Touch

| File | Status | Role |
|---|---|---|
| `docs/architecture/firestore-sync-backup.md` | NEW | Explanation: sync/backup architecture post-cleanup |
| `docs/architecture/app-scope-di.md` | NEW | Explanation: app-scope coroutine scope + DI conventions |
| `docs/architecture/batched-tag-reads.md` | NEW | Reference: client-only batched-tag-read query shape |
| `README.md` | Modified | One line: FTS correction + restore memory fix |

## Proposed Change Strategy

Three new Markdown files in `docs/architecture/` plus one README line. No build tooling, no
generated output, no links to internal workflow files. All docs are authored in one pass after the
five structural slices have been implemented and reviewed — the implementer reads the shipped code
to confirm accuracy before writing, then runs the leak-check step.

---

### Doc 1 — `docs/architecture/firestore-sync-backup.md` (Explanation)

**Purpose:** Explain the shape of the Firestore sync/backup layer so a maintainer understands what
exists, where it lives, and why it is structured the way it is. Audience: a developer joining the
project who needs to touch the sync/backup layer.

**Section outline:**

1. **Overview** — one paragraph: what this layer does (bidirectional sync between Room and Firestore,
   per-user article/tag/image subcollections, authenticated users only).

2. **Collection layout** — brief table of the collection constants defined in
   `FirestoreBackupService.companion`: `users`, `articles`, `tags`, `images`, `text`,
   `articleMarkers`, `article_authors`, `article_videos`, `domains`, their Firestore paths, and which
   subcollection is the large-text overflow store. Single source of truth for path strings.

3. **Authentication guard** — `withAuthenticatedUser { user -> ... }` is a private inline helper on
   `FirestoreBackupService` that wraps every public method; returns `Result.failure` if no user is
   authenticated. `FirestoreSyncManager` uses an intentionally distinct early-return guard (sets
   `_syncStatus.value = SyncStatus.Error(...)`) — these are NOT unified and should NOT be unified.

4. **Write path** — `addArticleToBatch(batch, articleRef, article, tags)`: large-text branching
   (inline if `toByteArray().size <= 900 000`, else offloaded to the `text/content` subcollection),
   article doc set via `SetOptions.merge()`, tag docs written into the same batch. Used by both
   `backupArticle` (per-article canonical path) and `backupArticlesPaginated` (chunk batch, tags
   pre-fetched by caller). Chunk size governed by Firestore rules document-access budget
   (`WRITE_BATCH_LIMIT=20`), not the 10 MiB/commit ceiling.

5. **Sync deduplication helpers** — `applyRemoteArticles(articles)` in `FirestoreSyncManager`:
   private suspend function that prefetches tags via `batchRestoreArticleTags`, then calls
   `handleRemoteArticleChange(article, prefetchedTags)` per article. Both restore call sites in
   `performFullSync` and `performBidirectionalSync` delegate to it.

6. **Streamed restore — memory contract** — `restoreAllArticlesPaginated` signature:
   ```kotlin
   suspend fun restoreAllArticlesPaginated(
       onProgress: (current: Int, total: Int) -> Unit = { _, _ -> },
       onPage: suspend (List<Article>) -> Unit = {}
   ): Result<Unit>
   ```
   Pages of `RESTORE_PAGE_LIMIT=50` articles are delivered via `onPage` and written to Room before
   the next page is fetched. No list accumulation — the previous full-list-return API
   (`restoreAllArticles()`) has been removed. Partial-restore on `onPage` failure: Room retains
   delivered pages; subsequent sync fills gaps via idempotent upsert.

7. **Large-text rehydration on restore (A2b)** — articles whose `text` field was `null` in the
   Firestore document (stored in the `text/content` subcollection) are rehydrated by
   `rehydrateLargeText(article, articleRef)` inside the paging loop, before `onPage` is called. This
   brings bulk restore to parity with single-article `restoreArticle()`. Articles with non-null
   inline text incur no extra read.

8. **Batched tag reads** — `batchRestoreArticleTags(articleIds)` on `FirestoreBackupService`:
   subcollection reads dispatched in parallel chunks of `RESTORE_TAG_CHUNK_SIZE=10` using
   `coroutineScope { ... async { ... }.awaitAll() }`. N sequential reads → `ceil(N/10)` parallel
   round-trips. A `collectionGroup` query was evaluated and rejected: `ArticleTags` documents carry
   no `userId` field, making cross-user isolation impossible without a schema migration. No Firestore
   index or rules change was made.

9. **FTS search fix** — `ArticleRepository.searchWithScore(query)` previously computed
   `sanitizedQuery` then passed the raw `query` to the DAO (the sanitized value was silently
   discarded). The fix passes `sanitizedQuery` to the DAO. **Result-set impact:** queries containing
   FTS-special characters (`*`, unbalanced quotes, `AND`/`OR`/`NEAR` operators) now return results
   matching sanitized + wildcard semantics. Queries that previously hit Room's `MATCH` with a
   malformed expression (which would throw or return empty) now return correct results.

---

### Doc 2 — `docs/architecture/app-scope-di.md` (Explanation)

**Purpose:** Explain the coroutine scope conventions so a maintainer knows which scope to use for
background work and why the app-level scope is structured the way it is. Audience: a developer adding
a new feature that needs a long-lived coroutine.

**Section outline:**

1. **The `@ApplicationScope` scope** — one paragraph: Hilt `@Singleton @ApplicationScope
   CoroutineScope(SupervisorJob() + ioDispatcher)` provided by `AppScopeModule` in
   `SingletonComponent`. Lives for the app process lifetime. Available via constructor injection with
   `@ApplicationScope` qualifier.

2. **Why `SupervisorJob()`** — a bare `CoroutineScope(dispatcher)` (no `SupervisorJob`) is cancelled
   permanently on the first child exception. In a singleton scope, this silently breaks all subsequent
   launches for the remaining process lifetime. `SupervisorJob()` isolates child failures: a failing
   child does not cancel its siblings or the parent scope.

3. **When to use `@ApplicationScope` vs `viewModelScope`** — decision table:

   | Scenario | Use |
   |---|---|
   | Work tied to a ViewModel's lifecycle (UI state, user interaction) | `viewModelScope` |
   | Background sync, Firestore write, Room insert that must survive ViewModel destruction | `@ApplicationScope` |
   | One-shot work in a `WorkManager` worker | The worker's coroutine scope (provided by `CoroutineWorker`) |

4. **`cleanup()` must not cancel the shared scope** — `FirestoreSyncManager.cleanup()` previously
   called `scope.cancel()` on a private ad-hoc scope. Now that the scope is an `@ApplicationScope
   @Singleton`, cancelling it in `cleanup()` would kill all future coroutine launches in
   `ArticleRepositoryImpl` and any other consumer for the process lifetime. The `cleanup()` method
   is intentionally a no-op comment.

5. **Anti-pattern** — do NOT construct `CoroutineScope(ioDispatcher)` or
   `CoroutineScope(SupervisorJob() + Dispatchers.IO)` in a field initialiser inside a `@Singleton`
   class. These create unmanaged scopes with no lifecycle awareness and no shared supervision. Inject
   `@ApplicationScope CoroutineScope` instead.

---

### Doc 3 — `docs/architecture/batched-tag-reads.md` (Reference)

**Purpose:** Concise reference note on the query shape used for bulk tag reads during restore, and
the rationale for the client-only approach. Audience: a developer debugging a restore or adding a
new subcollection read pattern.

**Section outline:**

1. **Query shape** — `batchRestoreArticleTags(articleIds: List<String>): Map<String, List<ArticleTags>>`
   on `FirestoreBackupService`. For each article ID, reads:
   ```
   users/{uid}/articles/{articleId}/tags/   (full subcollection get)
   ```
   IDs are chunked at `RESTORE_TAG_CHUNK_SIZE = 10`; each chunk is dispatched in parallel with
   `coroutineScope { chunk.map { async { ... } }.awaitAll() }`. Returns a map keyed by article ID.
   Empty list for articles with no tags. Returns `emptyMap()` if the user is not authenticated.

2. **Why not `collectionGroup`** — three bullets:
   - `ArticleTags` documents carry fields `itemId`, `tag`, `sortId`, `type` — no `userId` field.
     A `collectionGroup("tags")` query cannot filter to the authenticated user's tags without a
     `userId` field, making cross-user data isolation impossible.
   - No `firestore.indexes.json` exists in the project; adding a `COLLECTION_GROUP`-scoped composite
     index would require creating that file and a shared-project deploy.
   - A schema migration (adding `userId` to every tag document) is out of scope.

3. **Chunk size** — `RESTORE_TAG_CHUNK_SIZE = 10` (constant in `FirestoreBackupService.companion`).
   Safe well below Firestore SDK concurrent-read limits. Upper bound: keep at or below 30 (the
   `whereIn` cap) for future refactoring symmetry. Tune by changing the constant only.

4. **Single-article path** — `restoreArticleTags(articleId)` is the existing single-article tag read
   used by `restoreArticle()`. It is NOT replaced by `batchRestoreArticleTags` — the single-article
   path remains correct for its use case.

---

### README update

In the `| android/ | ... |` table row or immediately after the table, add one line:

> **Search** returns sanitized FTS results (special characters and operators are correctly handled
> before reaching the database). **Restore** streams articles page-by-page with constant memory —
> large libraries no longer risk OOM.

This is the only user-visible / operator-visible change that belongs in the README.

## Step-by-Step Plan

**Step 1 — Verify the structural slices are fully implemented and green**
Confirm `app-scope`, `firestore-dedup`, `firestore-io`, `streaming-restore`, and `batched-tag-reads`
are all implemented and their test suites are passing. Read the shipped source files to confirm
the actual signatures and constants match the upstream plans. Divergences (e.g. a constant renamed
during implementation) must be reflected in the docs, not the plan.

Key files to read before writing:
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt`
  (companion constants, `addArticleToBatch`, `batchRestoreArticleTags`, `restoreAllArticlesPaginated`,
  `withAuthenticatedUser`, `rehydrateLargeText`)
- `android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreSyncManager.kt`
  (auth guards, `applyRemoteArticles`, `handleRemoteArticleChange`)
- `android/app/src/main/java/com/jayteealao/trails/common/di/AppScopeModule.kt`
- `android/app/src/main/java/com/jayteealao/trails/data/ArticleRepository.kt`
  (`searchWithScore` — confirm sanitizedQuery is now passed to DAO)

**Step 2 — Create `docs/architecture/` directory and write `firestore-sync-backup.md`**
Follow the section outline in Proposed Change Strategy. Use the actual constant names and signatures
from Step 1. Include a one-line header with file path for each referenced component. Do NOT reference
PR numbers, slice names, plan files, or any SDLC vocabulary.

**Step 3 — Write `docs/architecture/app-scope-di.md`**
Follow the section outline. Use the actual qualifier name, module name, and class names from Step 1.

**Step 4 — Write `docs/architecture/batched-tag-reads.md`**
Follow the section outline. Confirm `RESTORE_TAG_CHUNK_SIZE` value and constant location from Step 1.

**Step 5 — Update `README.md`**
Add one line on FTS correction and restore memory contract in the Android client description (see
Proposed Change Strategy). Keep the change minimal — the README is a monorepo overview, not an
architecture reference.

**Step 6 — Leak check**
Run the following grep across all three new docs and the README diff:
```
grep -riE "slice|sdlc|workflow|04-plan|03-slice|wf-|simplify-android-app|architecture-docs" docs/architecture/ README.md
```
Expected: zero matches. If any match is found, remove the offending phrase before proceeding.

**Step 7 — Accuracy review**
Human review against the shipped code: the docs accurately describe the SHIPPED architecture; no
internal SDLC/workflow references; the reference doc reflects the client-only outcome (no mention
of deployed index or rules change). Review checklist:
- [ ] `withAuthenticatedUser` applied to FBS only (not FSM).
- [ ] Streaming restore return type is `Result<Unit>` (not `Result<List<Article>>`).
- [ ] `batchRestoreArticleTags` uses `coroutineScope + async + awaitAll`, chunk size = 10.
- [ ] FTS section says the sanitized query now reaches the DAO.
- [ ] No mention of collectionGroup as deployed or active.
- [ ] No SDLC leak check passing (Step 6).
- [ ] README change is one line, no internal references.

## Test / Verification Plan

**Verification is manual + review only** (no automated tests for documentation):

1. **Leak check** (Step 6): grep for internal SDLC vocabulary as above. Pass = zero matches.
2. **Accuracy review** (Step 7): human review against shipped source. Each section heading maps to
   a code artefact that can be read for confirmation.
3. **Markdown lint** (optional): if a markdown linter is configured in the project CI, run it. No
   markdown linter was found in `android/` or repo root at planning time — skip if none exists.

## Risks / Watchouts

**MEDIUM — Docs drift if written before architecture settles**
This slice has a hard dependency on five structural slices. If any of those plans change during
implementation (e.g. a constant is renamed, a helper signature changes), the docs must reflect the
final shipped code, not the upstream plan text. The implementer must read the actual source (Step 1)
before writing, not copy from the plan files.

**MEDIUM — External Output Boundary leak**
The published docs must contain zero references to SDLC artifacts, workflow files, slice names, plan
IDs, or internal planning vocabulary. The dedicated grep in Step 6 is a hard gate.

**LOW — collectionGroup reference confusion**
The reference doc must frame collectionGroup as "evaluated and rejected" with a brief rationale —
NOT as a future option to deploy, and NOT as something that was deployed. The client-only approach
is final for this codebase shape.

## Dependencies on Other Slices

This slice is the final slice in the DAG. It MUST land after all five structural slices:

| Slice | Why |
|---|---|
| `app-scope` | Documents the `@ApplicationScope` qualifier, `AppScopeModule`, and the neutered `cleanup()` |
| `firestore-dedup` | Documents `withAuthenticatedUser`, `addArticleToBatch`, `applyRemoteArticles`, tag-backup delegation |
| `firestore-io` | Documents single user-meta read, tag-in-chunk-batch, `deleteAllTagsForArticle`; confirms `toByteArray().size` is correct |
| `streaming-restore` | Documents the `suspend onPage` callback shape, `Result<Unit>` return, `rehydrateLargeText` |
| `batched-tag-reads` | Documents `batchRestoreArticleTags`, chunk size, client-only rationale |

Also soft-depends on `fts-search-fix` (documents the FTS correction and result-set impact).

## Assumptions

1. The structural slices implement the architecture described in their upstream plans without material
   deviation. If a helper is renamed or a signature differs, Step 1 will catch it.
2. `docs/architecture/` does not yet exist — confirmed by filesystem check (`docs/` contains only
   `runbooks/`). The implementer creates the directory.
3. No markdown linter is configured at the repo root or in `android/`. If one is added before this
   slice lands, run it as an additional check.
4. The README update is one line — the README is a monorepo overview; no deeper architecture
   description belongs there.
5. The three new docs do not require cross-links to each other or to the README, beyond natural
   prose references to class/method names.

## Blockers

None. All architectural decisions have been resolved by the upstream plans. The only prerequisite
is that the structural slices are implemented — that is a sequencing constraint, not a blocker.

## Freshness Research

No external web research is required for documentation. All architectural decisions (streamed restore
API shape, client-only batched reads, supervised app scope, FTS sanitization fix) are resolved in
the upstream plans and confirmed by code inspection in Step 1.

The doc target location (`docs/architecture/`) and format (Markdown) are confirmed by the existing
`docs/runbooks/` convention and the `02-shape.md` § Documentation Plan directive.

## Revision History

_(none — rev 1 is the initial plan)_

## Recommended Next Stage

`/wf implement simplify-android-app architecture-docs`

Prerequisites (all hard gates):
- `app-scope` implemented and green.
- `firestore-dedup` implemented and green.
- `firestore-io` implemented and green.
- `streaming-restore` implemented and green.
- `batched-tag-reads` implemented and green.
- `fts-search-fix` implemented and green (for FTS section accuracy).

Implement in order: Step 1 (read shipped code) → Steps 2–5 (write docs) → Step 6 (leak check) →
Step 7 (accuracy review).
