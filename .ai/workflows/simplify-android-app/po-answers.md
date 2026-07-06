# Product Owner Answers — simplify-android-app

Cumulative log. Newest entries appended.

## 2026-06-14 — intake

Source of work: triage artifact `.ai/simplify/20260613T0415Z.md` (codebase-scope
review of `android/app/src/main/java/com/jayteealao/trails`, 37 findings — 11 reuse,
13 quality, 13 efficiency).

### Batch A (structured) — answered 2026-06-14
- Branch strategy: **Dedicated** → `feat/simplify-android-app` off `main`; PR at handoff.
- Appetite: **Large** → multi-day, slice the 37 findings into incremental cleanups.
- Review scope: **Slug-wide** → one review over the whole branch diff at the end.
- Risky/behaviour-changing items (quality-8 FTS bug, efficiency-4 N+1 restore, efficiency-5 OOM restore): **Include all 3** as their own slices with AC + tests.

### Batch B (freeform) — proposed defaults applied (auto-derived from the triage; confirm or amend in shape)
- **Intended outcome:** Reduce maintenance cost and runtime cost of the Android app by acting on the 37 triage findings — without changing user-visible behaviour except where a finding is an explicit fix (quality-8) or a resource-safety improvement (efficiency-4/5).
- **Success criteria (proposed):**
  1. All 37 findings either resolved or explicitly deferred with a recorded reason.
  2. No behavioural regressions: existing unit/UI tests stay green; new tests cover quality-8 (FTS sanitization) and the restore-path changes (efficiency-4/5).
  3. Firestore sync/backup duplication removed (single source for tag-backup, collection constants, auth-guard, large-text handling).
  4. Article list scrolling does no per-recomposition HTML parsing and runs no dead animations.
- **Non-goals (proposed):** No new features; no UI redesign; no dependency upgrades; no changes to the `warg/` Cloudflare stack; no Firestore schema change beyond what efficiency-4 strictly requires (index only, if needed).
- **Stack confirmation (proposed, awaiting PO):** android · kotlin 2.2.20 · compose · gradle · hilt + room + firebase + coil + paging · tests: junit/robolectric/espresso/mockk/compose-ui-test/macrobenchmark · logging: timber. `stack.user-confirmed` stays `false` until confirmed.

## 2026-06-14 — shape (20-question discovery, 5 rounds)

### Round 1 — core scope & unit of work
- **Slicing axis:** **By code area / file** — one slice per file cluster (FirestoreSyncManager+BackupService, ArticleRepository, ArticleDetailViewModel, ArticleListViewModel, ArticleListItem+Grid, SyncWorker, ArticleThumbnail).
- **Ordering:** **Risky 3 first** — quality-8 (FTS), efficiency-4 (N+1), efficiency-5 (OOM) land before the behaviour-preserving cleanups.
- **Completeness:** **Deferrals allowed with a recorded reason** if a finding proves riskier/larger than triaged.
- **quality-13 (empty NavigateToArticle handler):** **Remove the registration** (confirmed dead).

### Round 2 — behaviour & contracts of the risky items + regression net
- **efficiency-4 approach:** **Decide in plan** — shape records the deploy/rules constraint (collectionGroup needs composite index + rules on shared trails-e428e; whereIn cap 30); plan picks after inspecting live rules + tag-subcollection shape.
- **efficiency-5 restore API shape (Flow vs callback):** **Decide in plan** — shape fixes the requirement (constant memory, write page-at-a-time); plan picks the shape with both call sites open.
- **App scope (quality-1):** **Add a shared @ApplicationScope** Hilt `@Singleton CoroutineScope(SupervisorJob()+dispatcher)`; inject into ArticleRepository and consolidate FirestoreSyncManager's ad-hoc scope onto it.
- **Regression net:** **Characterization tests first** — pin current FirestoreSyncManager/BackupService behaviour before the dedup refactors.

### Round 3 — surface area, UI verification, stack accuracy
- **UI verification:** **Compose UI tests + manual scroll** for the article-list changes (no perf harness; assert state + behaviour-preservation).
- **Palette/animation coupling:** **Investigate palette consumers first** — if the extracted palette only fed the now-dead gradient (efficiency-6), drop palette extraction and the allowHardware problem disappears.
- **Stack correction:** **Apply** — drop `robolectric` + `macrobenchmark` (neither exists); testing = junit + mockk + kotlinx-coroutines-test + compose-ui-test + work-testing + hilt-testing. `stack.user-confirmed` → true.
- **Definition of Done (Batch B):** **Adopt as-is.**

### Round 4 — failure modes & risk posture
- **Adjacent latent bugs:** **Fix in scope if adjacent** — e.g. fix bulk-restore large-text (>900KB) rehydration alongside efficiency-5 (restoreAllArticlesPaginated currently drops it; restoreArticle rehydrates).
- **quality-8 FTS semantics:** **Pin corrected behaviour with tests** — assert intended sanitized + wildcard/prefix semantics; accept pre-fix result sets change.
- **efficiency-4 deploy gating:** **Resolve at efficiency-4 plan.**
- **Risk posture:** **Decide per slice** — safety bar scaled to blast radius.

### Round 5 — boundaries, transitions, open questions
- **Extra scope (beyond 37 + adjacent):** **Revive needed test infra** (TestDatabaseModule, DefaultArticleRepositoryTest) + **Remove deprecated restoreAllArticles()** + **Broaden quality-11** to move ALL ViewModel direct-DAO usage behind the repository.
- **Transition:** **Hard cutover** — replace internal signatures outright, update all callers in the same slice (all callers are in-app).
- **Docs:** **Full Diátaxis pass** — reference + explanation for the refactored sync/backup architecture and the new app-scope/DI conventions.
- **Blockers:** **None — proceed to slice.** Deferred specifics (efficiency-4/5 approach, deploy gating, palette consumers) are plan-stage work.

## 2026-06-14 — slice (seam-decision discovery, 1 round of 4)

Discovery scope was narrowed: the axis (by code area), order (risky-3-first), deferrals, hard
cutover, and Diátaxis docs were already settled in shape and were **not** re-asked. The four
questions targeted only the *seams* — where behaviour-changing and behaviour-preserving work land
on the same files.

- **ArticleRepository seam:** **A1 alone, B3 later.** The FTS fix (`fts-search-fix`/A1, behaviour-
  changing, own pinning tests) is isolated from the preserving repo cleanup (`article-repository`/B3,
  `delete()`/`add()`).
- **Firestore layer granularity:** **4 slices — A2, A3, B1, B2.** Risky restore items isolated
  (`streaming-restore`, `batched-tag-reads` with its deploy gate), then `firestore-dedup` (B1) and
  `firestore-io` (B2) as separate preserving slices. Thinnest option.
- **Test net:** **Dedicated test-net slice first** (`test-net` = E1 revive + Firestore
  characterization). Explicit, verifiable gate; nothing refactors until green.
- **List UI coupling:** **One list-rendering slice (B6+B8 merged).** Removing the dead gradient may
  delete B8's only palette consumer, so trace consumers + decide palette/`allowHardware` in one place.

Result: **14 slices**, best-first = `test-net`. Three open specifics remain plan-stage work, now
homed on their owning slices (efficiency-4 → `batched-tag-reads`, efficiency-5 → `streaming-restore`,
efficiency-12 → `list-rendering`).

## 2026-06-14 — plan (all 14 slices, parallel; dependency-tiered)

No PO interview this stage — the three deferred specifics were settled by **code inspection**,
exactly as shape directed ("decide in plan"). Each owning plan records the evidence:

- **efficiency-4 (batched-tag-reads) → CLIENT-ONLY chunked parallel reads.** collectionGroup
  rejected on inspection: `ArticleTags` has no `userId` field (can't scope a collectionGroup
  query to the auth'd user without a schema migration) and no `firestore.indexes.json` exists.
  **Not deploy-gated** — `firebase/` and `trails-e428e` untouched; the workflow stays android/-only.
- **efficiency-5 (streaming-restore) → `suspend onPage` callback** (over `Flow<List<Article>>`).
  Both call sites already `fold→chunked(...)`; the callback collapses that to one lambda with
  identical cancellation/backpressure and no Flow plumbing. A2b large-text rehydration + deprecated
  `restoreAllArticles()` removal folded in.
- **efficiency-12 (list-rendering) → DROP palette entirely.** Consumer trace: `extractPaletteFromBitmap`
  fed only the (now-removed) gradient overlay + a shadow tint — no other reader — so palette
  extraction and `allowHardware(false)` are both removed; the HARDWARE-bitmap concern dissolves.

Additional plan-stage findings (recorded, non-blocking):
- **efficiency-13 already correct** — both backup paths already use `text.toByteArray().size`; the
  triaged `text.length` bug is not in the code. No-op, resolved-as-found (owned by `firestore-io`).
- **cross-cutting-url** — 9 normalization sites total, all byte-identical (no divergence); the real
  duplication is the 4 Article-typed `url ?: givenUrl ?: ""` idiom sites (the 5 string-typed
  `normalizeUrl(...)` sites are intentionally left).
- **app-scope** carries the one high-risk item: `FirestoreSyncManager.cleanup()`'s `scope.cancel()`
  must be neutered (singleton scope lives app-lifetime).

All 14 plans: **has-blockers: false**, **0 conflicts**, **no deploy gate**. Recommended order and
parallelizable groups in `04-plan.md`.
