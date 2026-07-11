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

## 2026-07-09 — extend (extension round 1)
Stage: extend | Scope: reconcile-stall-guard (runtime-found regression from PR #29 sync test)

- **Slice scope** → include ALL THREE findings in one slice: (1) stall-guard fix + regression test,
  (2) reconcile skipped when no incremental changes ("No local changes to sync" gating),
  (3) freshly-downloaded articles land backed_up_at=NULL and re-upload (churn).
- **Fix approach** → row-identity stall detection (a stall = the same rows returning; a repeating
  full chunk of *different* rows is normal progress). Not chunk-size equality.
- **Grouping** → one combined slice (`reconcile-stall-guard`), not three — same subsystem, same test
  harness. depends-on: none blocking (firestore-io / sync-worker / firestore-dedup are complete).
- **Confirm** → proceed; wrote 03-slice-reconcile-stall-guard.md, updated 03-slice.md (total 14→15)
  and 00-index.md workflow-files. No existing slice modified.

## 2026-07-10 — plan (reconcile-stall-guard, 2 rounds of 4 + 1 gate question)
Stage: plan | 2026-07-10T21:32:04Z

### Round 1 — fix shapes
- **Stall signal** → **Full-chunk identity**: stall = the SAME set of itemIds returning as last
  iteration (Set<String> comparison). Robust to partial-stamp of the head row; head-id-only and
  stamped-count signals rejected.
- **Hard cap** → **Yes, generous**: MAX_RECONCILE_ITERATIONS = 1000 (~20k articles) as an
  independent failsafe; exact count-derived cap rejected.
- **Gating shape** → **Sweep inside the zero-branch**: call reconcileNeverBackedUpArticles() in the
  totalCount == 0 branch before SyncStatus.Success("Up to date"); preserves sweep-after-upload
  order in the has-changes path. Hoist-above-return and skip-upload-only restructure rejected.
- **Stamp method** → **Set backedUpAt in the upsert copy** (atomic single Room write) at the two
  remote-won sites of handleRemoteArticleChange(); local-wins branch untouched. Separate
  updateBackedUpAt call rejected (second write + unstamped window).

### Round 2 — semantics & posture
- **Stamp value** → **Current time at apply** (System.currentTimeMillis()), consistent with the
  sweep's own stamping; preserve-remote-value rejected.
- **Drain window** → **Add setForeground() in this slice** (PO diverged from recommendation).
  Plan finding: ALREADY IMPLEMENTED — FirestoreSyncWorker.doWork() calls
  setForeground(getForegroundInfo()) at line 38 before syncLocalChanges(), with full
  notification-channel helper (SyncWorkHelpers.kt); targetSdk 33 → no foregroundServiceType work
  due. Lands as a verify-don't-build step (resolved-as-found, efficiency-13 precedent).
- **AC2 test shape** → **DAO returns same page forever** (backup succeeds, updateBackedUpAt no-op);
  verify loop exits after exactly 2 fetches. Throwing-stamp variant not required.
- **Sweep logging** → **Log backlog count at start** (PO diverged from recommendation): new
  ArticleDao.countArticlesNeverBackedUp() @Query + Timber.d at sweep start, making "N remaining
  → 0" observable in logcat for the live re-run.

### Gate — repeat-deferral tripwire (5th occurrence of the headless-device wall)
- **Device wall** → **Decline harness** (harness-declined, on the record): the wall is
  environmental (no display/GPU in agent sessions), all 5 ACs are pure-JVM automated, and the live
  probe-scenario re-run (200/250 → 0 rows backed_up_at IS NULL) is a one-time manual confirmation
  on a real device — same posture as the prior 4 deferrals. Headless-emulator harness rejected
  (unproven on this host, own-slice-sized work).

## Ship — run 20260711T0112Z (2026-07-11T01:12:05Z)

- **[ship 1.2] Version for this release?** → `1.10.24` (patch; PO chose patch over the recommended minor — treat branch as cleanup + fixes).
- **[ship 6.5-override] Runtime-evidence deferrals** → PO risk-acceptance recorded as `ship-override-authorization` on all 5 open deferrals (4 on simplify-android-app, 1 on rca-saved-articles-no-archives). Rationale: headless agent environment cannot boot AVDs; Rung-1 unit/emulator coverage accepted; residual device smokes deferred post-ship.
- **[ship 3.1] Rollout strategy?** → Immediate (plan default). Only Android + Firestore rules ship this run; no Warg deploy needed (no warg/ changes on branch).
- **[ship 3.2] Release window?** → No constraints — ship now.
- **[ship 3.3] Stakeholder/compliance sign-off?** → None beyond plan defaults (GitHub Release page as announcement).
- **[ship 5] Go/No-Go?** → **Go.** All gates pass (pre-flight warn-only, dry-run green, reviews ship, platform healthy, no blocking CVEs). Caveats recorded: fragile firebase-rules deploy path (unpinned firebase-tools + deprecated FIREBASE_TOKEN — verify rules deploy post-merge), 5 deferrals shipped on PO override, advisory-only dependency notes (Kotlin CVE-2026-53914 build-infra, Okio 3.16.0 timeout regression, OkHttp 5.4.0 hardening).
